"""Ingest 3 pintu: parsing, validasi, flatten FHIR-like, lalu PSEUDONIMISASI sebelum masuk analitik.

Setelah fungsi `ingest()` selesai, NIK & ID dokter mentah tidak lagi ada di frame mana pun yang dipakai engine.
"""
from __future__ import annotations

import io
import json
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .privacy import pseudonymize, pseudonymize_series

PROC_REQUIRED = ["facility_id", "drug_name", "qty", "unit_price", "purchase_date", "invoice_input_date"]
CLAIM_REQUIRED = ["claim_id", "rme_encounter_ref", "facility_id", "nik", "doctor_id", "claim_channel", "drug_name", "claim_date", "qty", "unit_price"]
CHANNELS = {"INA-CBG", "PRB", "Non-Paket"}
LABEL_COLUMNS = {"label_fraud", "scenario", "variant"}


class IngestError(ValueError):
    def __init__(self, message: str, problems: list[str] | None = None):
        super().__init__(message)
        self.message = message
        self.problems = problems or []


@dataclass
class Ingested:
    proc: pd.DataFrame
    claims: pd.DataFrame
    enc: pd.DataFrame
    med: pd.DataFrame
    privacy: dict = field(default_factory=dict)
    counts: dict = field(default_factory=dict)


def read_csv_bytes(data: bytes, label: str) -> pd.DataFrame:
    if not data or not data.strip():
        raise IngestError(f"File {label} kosong.")
    try:
        # Read everything as text first so identifiers keep leading zeroes.
        df = pd.read_csv(io.BytesIO(data), dtype=str, keep_default_na=False)
    except Exception as exc:  # noqa: BLE001
        raise IngestError(f"File {label} bukan CSV yang valid.", [str(exc)[:200]]) from exc
    df.columns = [str(c).strip() for c in df.columns]
    return df


def read_rme_bytes(data: bytes) -> dict:
    try:
        obj = json.loads(data.decode("utf-8-sig"))
    except Exception as exc:  # noqa: BLE001
        raise IngestError("File RME bukan JSON yang valid.", [str(exc)[:200]]) from exc
    if not isinstance(obj, dict) or not isinstance(obj.get("entry"), list):
        raise IngestError("RME harus berupa Bundle FHIR-like dengan array 'entry'.")
    return obj


def _require(df: pd.DataFrame, required: list[str], label: str) -> None:
    if df.empty:
        raise IngestError(f"Data {label} kosong — tidak ada baris yang dapat diaudit.")
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise IngestError(f"Kolom wajib pada {label} tidak ditemukan.", [f"Kolom hilang: {', '.join(missing)}"])
    leaked = LABEL_COLUMNS & set(df.columns)
    if leaked:
        raise IngestError(f"{label} memuat kolom label ({', '.join(sorted(leaked))}). Label harus dikirim sebagai file terpisah dan tidak boleh ikut inferensi.")


def _required_text(df: pd.DataFrame, cols: list[str], label: str) -> None:
    for col in cols:
        values = df[col].astype("string").str.strip()
        empty = values.isna() | values.eq("") | values.str.lower().isin(["nan", "null", "none"])
        if empty.any():
            raise IngestError(f"Kolom identitas kosong pada {label}.{col}.", [f"{int(empty.sum())} baris tidak memiliki nilai."])
        df[col] = values.astype(str)


def _dates(series: pd.Series, col: str, label: str) -> pd.Series:
    out = pd.to_datetime(series, errors="coerce").dt.normalize()
    bad = int(out.isna().sum())
    if bad:
        raise IngestError(f"Format tanggal tidak valid pada {label}.{col}.", [f"{bad} baris tidak dapat dibaca sebagai tanggal (gunakan YYYY-MM-DD)."])
    return out


def _numbers(df: pd.DataFrame, cols: list[str], label: str) -> None:
    for c in cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
        values = df[c].to_numpy(dtype=float)
        if not np.isfinite(values).all():
            raise IngestError(f"Nilai non-numerik atau tidak terbatas pada {label}.{c}.", [f"{int((~np.isfinite(values)).sum())} baris bermasalah."])
        if (df[c] < 0).any():
            raise IngestError(f"Nilai negatif pada {label}.{c}.")


def flatten_rme(bundle: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    enc_rows, med_rows = [], []

    def ident(res: dict, key: str) -> str:
        return str(((res.get(key) or {}).get("identifier") or {}).get("value", ""))

    def payer(res: dict) -> str:
        for ext in res.get("extension", []) or []:
            if ext.get("url") == "payer":
                return str(ext.get("valueString", "JKN"))
        return "JKN"

    for entry in bundle["entry"]:
        res = entry.get("resource", entry)
        kind = res.get("resourceType")
        if kind == "Encounter":
            part = (res.get("participant") or [{}])[0].get("individual", {}).get("identifier", {}).get("value", "")
            enc_rows.append({"enc_id": res.get("id"), "nik": ident(res, "subject"), "doc": part, "fac": ident(res, "serviceProvider"),
                             "start": (res.get("period") or {}).get("start"), "end": (res.get("period") or {}).get("end"),
                             "cls": (res.get("class") or {}).get("code", ""), "payer": payer(res)})
        elif kind == "MedicationAdministration":
            ref = str((res.get("context") or {}).get("reference", "")).split("/")[-1]
            dose = (res.get("dosage") or {}).get("dose") or {}
            perf = ((res.get("performer") or [{}])[0].get("actor") or {}).get("identifier", {}).get("value", "")
            med_rows.append({"med_id": res.get("id"), "enc_ref": ref, "nik": ident(res, "subject"), "doc": perf, "fac": ident(res, "location"),
                             "name": (res.get("medicationCodeableConcept") or {}).get("text", ""), "date": res.get("effectiveDateTime"),
                             "dose": dose.get("value"), "unit": dose.get("unit", ""), "payer": payer(res)})
    enc, med = pd.DataFrame(enc_rows), pd.DataFrame(med_rows)
    if med.empty:
        raise IngestError("RME tidak memuat satu pun MedicationAdministration.")
    if enc.empty:
        enc = pd.DataFrame(columns=["enc_id", "nik", "doc", "fac", "start", "end", "cls", "payer"])
    return enc, med


def ingest(procurement: pd.DataFrame, claims: pd.DataFrame, rme: dict, secret: str) -> Ingested:
    p, c = procurement.copy(), claims.copy()
    _require(p, PROC_REQUIRED, "e-Katalog/ERP (Pintu 1)")
    _require(c, CLAIM_REQUIRED, "Klaim VEDIKA (Pintu 3)")
    _required_text(p, ["facility_id", "drug_name"], "procurement")
    _required_text(c, ["claim_id", "rme_encounter_ref", "facility_id", "nik", "doctor_id", "claim_channel", "drug_name"], "klaim")
    enc, med = flatten_rme(rme)
    _required_text(med, ["enc_ref", "nik", "doc", "fac", "name"], "RME MedicationAdministration")

    _numbers(p, ["qty", "unit_price"], "procurement")
    _numbers(c, ["qty", "unit_price"], "klaim")
    if "amount" not in c.columns:
        c["amount"] = c.qty * c.unit_price
    _numbers(c, ["amount"], "klaim")
    expected_amount = c["qty"] * c["unit_price"]
    consistent_amount = np.isclose(c["amount"].to_numpy(float), expected_amount.to_numpy(float), rtol=1e-4, atol=1.0)
    if not consistent_amount.all():
        bad_rows = (np.flatnonzero(~consistent_amount)[:5] + 2).tolist()
        raise IngestError(
            "Nilai amount tidak cocok dengan qty × unit_price pada file klaim.",
            [f"{int((~consistent_amount).sum())} baris tidak konsisten (contoh nomor baris CSV: {bad_rows})."],
        )
    p["purchase_date"] = _dates(p["purchase_date"], "purchase_date", "procurement")
    p["invoice_input_date"] = _dates(p["invoice_input_date"], "invoice_input_date", "procurement")
    c["service_date"] = _dates(c["claim_date"], "claim_date", "klaim")
    if "channel" not in p.columns:
        p["channel"] = "e-Katalog"
    if "invoice_no" not in p.columns:
        p["invoice_no"] = ""
    if c["claim_id"].duplicated().any():
        raise IngestError("claim_id ganda ditemukan pada file klaim.", [f"{int(c['claim_id'].duplicated().sum())} claim_id duplikat."])
    bad_ch = sorted(set(c["claim_channel"].astype(str)) - CHANNELS)
    if bad_ch:
        raise IngestError("Nilai claim_channel tidak dikenal.", [f"Diizinkan: {', '.join(sorted(CHANNELS))}. Ditemukan: {', '.join(bad_ch[:5])}"])
    if (p["invoice_input_date"] < p["purchase_date"]).any():
        raise IngestError("invoice_input_date lebih awal dari purchase_date pada sebagian baris procurement.")
    med["date"] = _dates(med["date"], "effectiveDateTime", "RME")
    med["dose"] = pd.to_numeric(med["dose"], errors="coerce")
    if med["dose"].isna().any() or (med["dose"] < 0).any():
        raise IngestError("Dosis RME tidak valid (kosong/negatif).")
    enc["start"] = pd.to_datetime(enc["start"], errors="coerce").dt.normalize()
    enc["end"] = pd.to_datetime(enc["end"], errors="coerce").dt.normalize().fillna(enc["start"])

    # ------------------------------------------------ PSEUDONIMISASI (sebelum analitik)
    c["pid"] = pseudonymize_series(c["nik"], secret)
    c["did"] = pseudonymize_series(c["doctor_id"], secret)
    enc["pid"] = pseudonymize_series(enc["nik"], secret) if len(enc) else pd.Series(dtype=str)
    enc["did"] = pseudonymize_series(enc["doc"], secret) if len(enc) else pd.Series(dtype=str)
    med["pid"] = pseudonymize_series(med["nik"], secret)
    med["did"] = pseudonymize_series(med["doc"], secret)
    n_nik = int(pd.concat([c["nik"], enc["nik"], med["nik"]]).nunique())
    n_doc = int(pd.concat([c["doctor_id"], enc["doc"], med["doc"]]).nunique())
    c = c.drop(columns=["nik", "doctor_id"])
    enc = enc.drop(columns=["nik", "doc"])
    med = med.drop(columns=["nik", "doc"])

    privacy = {
        "algorithm": "HMAC-SHA-256", "unique_nik_pseudonymized": n_nik, "unique_doctor_pseudonymized": n_doc,
        "raw_columns_removed_before_analytics": ["nik", "doctor_id (klaim)", "subject/nik (RME)", "participant/doctor (RME)"],
        "raw_rme_persisted": False,
    }
    counts = {"procurement": len(p), "claims": len(c), "rme_encounters": len(enc), "rme_medication_administration": len(med),
              "rme_non_jkn": int((med["payer"] != "JKN").sum())}
    return Ingested(p.reset_index(drop=True), c.reset_index(drop=True), enc.reset_index(drop=True), med.reset_index(drop=True), privacy, counts)
