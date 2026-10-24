"""Generator data sintetis 3 pintu dengan injeksi fraud berlabel (label disimpan terpisah).

Pintu 1  Procurement  (faktur e-Katalog/ERP)    -> DataFrame (CSV)
Pintu 2  RME          (resep/pemberian obat)    -> Bundle FHIR-like (JSON)
Pintu 3  Klaim VEDIKA                           -> DataFrame (CSV)
Label    claim_id, scenario, variant            -> DataFrame terpisah (TIDAK dipakai saat inferensi)

Skenario fraud (±15% baris klaim): phantom, inflate, duplicate, no_visit.
"Jebakan jujur" yang sengaja dibuat: wastage wajar (dosis -> vial dibulatkan ke atas), faktur terlambat input,
pembelian non e-Katalog dengan faktur sah, variasi nama merek + salah ketik, dosis tinggi yang sah,
refill PRB pasca rawat inap yang sah, dan fraud yang tersembunyi di balik stok penyangga.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

from .master import DRUG_BY_KFA, DRUGS, FACILITIES, FAC_BY_ID, Drug, Facility, expected_units, stocks

CLAIM_START = date(2026, 8, 1)
CLAIM_DAYS = 61                      # 1 Agu - 30 Sep 2026
PO_LEAD_DAYS = 12                    # stok awal dibeli sebelum jendela klaim
SCENARIO_SHARE = {"phantom": 0.30, "inflate": 0.30, "duplicate": 0.20, "no_visit": 0.20}
SUPPLIERS = ["PT Distribusi Medika Sintetis", "PT Farma Nusantara Sintetis", "PT Alkes Mandiri Sintetis", "PT Onko Prima Sintetis"]
PRB_DOSES = [28, 30, 56, 60, 84, 90]
PACKAGE_CODES = ["INA-CBG-I-4-10", "INA-CBG-E-4-10", "INA-CBG-K-4-12", "INA-CBG-J-4-14", "INA-CBG-D-4-10"]
SHOWCASE_PREFIX = "CLM-DEMO-"


@dataclass
class SyntheticBundle:
    procurement: pd.DataFrame
    rme: dict
    claims: pd.DataFrame
    labels: pd.DataFrame
    meta: dict = field(default_factory=dict)


@dataclass
class _Line:
    claim: dict
    med: dict | None
    use: tuple | None
    label: dict
    protected: bool = False


def _typo(rng: np.random.Generator, text: str) -> str:
    if len(text) < 7:
        return text
    i = int(rng.integers(2, len(text) - 2))
    if rng.random() < 0.5:
        return text[:i] + text[i + 1:]
    return text[:i] + text[i + 1] + text[i] + text[i + 2:]


def _name(rng: np.random.Generator, drug: Drug, door: str, counters: dict) -> str:
    p_generic = {"procurement": 0.35, "rme": 0.30, "claim": 0.65}[door]
    if rng.random() < p_generic:
        s = drug.generic
    else:
        s = str(rng.choice(drug.brands))
        counters["brand_variants"] += 1
    r = rng.random()
    if r < 0.08:
        s = s.upper()
    elif r < 0.12:
        s = s.lower()
    elif r < 0.14:
        s = _typo(rng, s)
        counters["typos"] += 1
    return s


class _World:
    def __init__(self, rng: np.random.Generator, fraud_rate: float):
        self.rng = rng
        self.lines: list[_Line] = []
        self.encs: list[dict] = []
        self.seq = defaultdict(int)
        self.counters = defaultdict(int)
        w = np.array([1.0, 1.0, 1.0, 1.0, 1.0, 0.35, 0.08])  # Senin..Minggu
        self.day_w = np.array([w[(CLAIM_START + timedelta(days=i)).weekday()] for i in range(CLAIM_DAYS)])
        self.fac_p = np.array([f.weight for f in FACILITIES]); self.fac_p = self.fac_p / self.fac_p.sum()
        fw = np.array([f.weight * f.fraud_mult for f in FACILITIES]); self.fraud_p = fw / fw.sum()
        self.docs = {f.id: [f"DR-{f.id[-1]}-{k:03d}" for k in range(1, 26)] for f in FACILITIES}

    # ---------------------------------------------------------------- util
    def nik(self) -> str:
        self.seq["nik"] += 1
        return f"99{(self.seq['nik'] * 48271 + 12345) % 10**14:014d}"  # NIK sintetis (prefiks 99)

    def doctor(self, fac: Facility) -> str:
        return str(self.rng.choice(self.docs[fac.id]))

    def rand_date(self, lo: int = 0, hi: int = CLAIM_DAYS - 1) -> date:
        idx = np.arange(lo, hi + 1)
        p = self.day_w[lo:hi + 1]
        return CLAIM_START + timedelta(days=int(self.rng.choice(idx, p=p / p.sum())))

    def pick_fac(self, fraud: bool = False) -> Facility:
        return FACILITIES[int(self.rng.choice(len(FACILITIES), p=self.fraud_p if fraud else self.fac_p))]

    def stocked(self, fac: Facility, *cats: str, min_price: int = 0) -> list[Drug]:
        return [d for d in DRUGS if (not cats or d.category in cats) and stocks(fac, d) and d.unit_price >= min_price]

    def nonstocked(self, fac: Facility, *cats: str, min_price: int = 0) -> list[Drug]:
        return [d for d in DRUGS if d.category in cats and not stocks(fac, d) and d.unit_price >= min_price]

    def enc(self, fac: Facility, nik: str, doc: str, start: date, end: date | None = None, cls: str = "AMB") -> str:
        self.seq["enc"] += 1
        eid = f"ENC-{self.seq['enc']:07d}"
        self.encs.append({"id": eid, "fac": fac.id, "nik": nik, "doc": doc, "start": start, "end": end or start, "cls": cls, "payer": "JKN"})
        return eid

    def line(self, *, enc_id: str, fac: Facility, nik: str, doc: str, drug: Drug, d: date, dose: float, qty: int,
             channel: str, scenario: str = "clean", variant: str = "", true_units: int | None = None,
             emit_med: bool = True, med_nik: str | None = None, claim_date: date | None = None,
             pkg: str = "", claim_id: str | None = None, protected: bool = False) -> _Line:
        self.seq["clm"] += 1
        cid = claim_id or f"CLM-{self.seq['clm']:07d}"
        u = expected_units(drug, dose)
        if true_units is None:
            true_units = u
        claim = {
            "claim_id": cid, "sep_no": f"SEP-{enc_id[4:]}", "rme_encounter_ref": enc_id, "facility_id": fac.id,
            "nik": nik, "doctor_id": doc, "claim_channel": channel, "package_code": pkg,
            "drug_name": _name(self.rng, drug, "claim", self.counters), "claim_date": (claim_date or d).isoformat(),
            "qty": int(qty), "unit_price": drug.unit_price, "amount": int(qty) * drug.unit_price,
        }
        med = None
        if emit_med:
            self.seq["med"] += 1
            med = {"id": f"MA-{self.seq['med']:07d}", "enc": enc_id, "nik": med_nik or nik, "doc": doc, "fac": fac.id,
                   "name": _name(self.rng, drug, "rme", self.counters), "date": d, "dose": float(dose), "unit": drug.dose_unit, "payer": "JKN"}
        use = (fac.id, drug.kfa_code, d, int(true_units)) if true_units > 0 else None
        if scenario == "clean" and dose % drug.pack_size != 0 and drug.pack_size > 1:
            self.counters["wastage_wajar"] += 1
        ln = _Line(claim, med, use, {"claim_id": cid, "label_fraud": int(scenario != "clean"), "scenario": scenario, "variant": variant}, protected)
        self.lines.append(ln)
        return ln

    def dose_for(self, drug: Drug, legit_high: bool = True) -> float:
        lo, hi = drug.dose_range
        if drug.category == "PRB":
            return float(self.rng.choice(PRB_DOSES))
        dose = float(self.rng.integers(lo, hi + 1))
        if legit_high and drug.category in ("Onkologi", "Albumin") and self.rng.random() < 0.03:
            dose = float(round(dose * self.rng.uniform(1.4, 2.0)))  # dosis tinggi yang sah (BSA besar)
            self.counters["dosis_tinggi_sah"] += 1
        return dose

    def channel(self, drug: Drug, inpatient: bool = False) -> str:
        if drug.category == "PRB":
            return "INA-CBG" if inpatient else "PRB"
        return "Non-Paket" if drug.category in ("Onkologi", "Albumin", "Alkes") else "INA-CBG"

    def pkg(self) -> str:
        return str(self.rng.choice(PACKAGE_CODES))

    # ---------------------------------------------------------------- kunjungan normal
    def visit_kemo(self, fac: Facility) -> bool:
        drugs = self.stocked(fac, "Onkologi")
        if not drugs:
            return False
        drug = drugs[int(self.rng.integers(len(drugs)))]
        d, nik, doc = self.rand_date(), self.nik(), self.doctor(fac)
        eid = self.enc(fac, nik, doc, d)
        dose = self.dose_for(drug)
        self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=drug, d=d, dose=dose, qty=expected_units(drug, dose), channel="Non-Paket")
        if self.rng.random() < 0.45:
            inf = DRUG_BY_KFA["KFA-INF-001"]
            dose2 = float(self.rng.integers(1, 3))
            self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=inf, d=d, dose=dose2, qty=int(dose2), channel="INA-CBG", pkg=self.pkg())
        return True

    def visit_prb(self, fac: Facility, refill: bool = True) -> bool:
        drugs = self.stocked(fac, "PRB")
        if not drugs:
            return False
        k = 2 if self.rng.random() < 0.25 and len(drugs) > 1 else 1
        chosen = [drugs[i] for i in self.rng.choice(len(drugs), size=k, replace=False)]
        nik, doc, d = self.nik(), self.doctor(fac), self.rand_date()
        doses = {c.kfa_code: float(self.rng.choice(PRB_DOSES)) for c in chosen}
        visit_date = d
        while True:
            eid = self.enc(fac, nik, doc, visit_date)
            for c in chosen:
                self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=c, d=visit_date, dose=doses[c.kfa_code], qty=int(doses[c.kfa_code]), channel="PRB")
            nxt = visit_date + timedelta(days=int(self.rng.integers(26, 34)))
            if refill and (nxt - CLAIM_START).days <= CLAIM_DAYS - 1 and self.rng.random() < 0.70:
                visit_date = nxt
                continue
            break
        return True

    def visit_inpatient(self, fac: Facility) -> bool:
        nik, doc, d = self.nik(), self.doctor(fac), self.rand_date(0, CLAIM_DAYS - 3)
        los = int(self.rng.integers(2, 7))
        end = min(d + timedelta(days=los), CLAIM_START + timedelta(days=CLAIM_DAYS - 1))
        eid = self.enc(fac, nik, doc, d, end, "IMP")
        pkg = self.pkg()
        span = max((end - d).days, 0)

        def when() -> date:
            return d + timedelta(days=int(self.rng.integers(0, span + 1)))

        items: list[tuple[Drug, float, str]] = []
        inf = DRUG_BY_KFA["KFA-INF-001" if self.rng.random() < 0.6 else "KFA-INF-002"]
        items.append((inf, float(self.rng.integers(*inf.dose_range)), "INA-CBG"))
        abx = self.stocked(fac, "Antibiotik")
        if abx and self.rng.random() < 0.7:
            a = abx[int(self.rng.integers(len(abx)))]
            items.append((a, float(self.rng.integers(a.dose_range[0], a.dose_range[1] + 1)), "INA-CBG"))
        alb = self.stocked(fac, "Albumin")
        if alb and self.rng.random() < 0.18:
            a = alb[int(self.rng.integers(len(alb)))]
            items.append((a, self.dose_for(a), "Non-Paket"))
        prb = self.stocked(fac, "PRB")
        if prb and self.rng.random() < 0.12:
            p = prb[int(self.rng.integers(len(prb)))]
            items.append((p, float(self.rng.choice([14, 21, 28])), "INA-CBG"))
        for drug, dose, ch in items:
            self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=drug, d=when(), dose=dose, qty=expected_units(drug, dose), channel=ch, pkg=pkg if ch == "INA-CBG" else "")
        return True

    def visit_alkes(self, fac: Facility) -> bool:
        drugs = self.stocked(fac, "Alkes")
        if not drugs:
            return False
        w = np.array([1.0 / math.log10(d.unit_price + 10) ** 3 for d in drugs]); w /= w.sum()
        drug = drugs[int(self.rng.choice(len(drugs), p=w))]
        d, nik, doc = self.rand_date(), self.nik(), self.doctor(fac)
        eid = self.enc(fac, nik, doc, d, cls="AMB")
        dose = float(self.rng.integers(drug.dose_range[0], drug.dose_range[1] + 1))
        self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=drug, d=d, dose=dose, qty=int(dose), channel="Non-Paket")
        if self.rng.random() < 0.5:
            abx = DRUG_BY_KFA["KFA-ABX-001"]
            self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=abx, d=d, dose=2.0, qty=2, channel="INA-CBG", pkg=self.pkg())
        return True

    def visit_post_discharge_legit(self, fac: Facility) -> bool:
        """Jebakan jujur: obat PRB ada di paket rawat inap, refill PRB baru >35 hari kemudian (sah)."""
        prb = self.stocked(fac, "PRB")
        if not prb:
            return False
        drug = prb[int(self.rng.integers(len(prb)))]
        nik, doc = self.nik(), self.doctor(fac)
        d0 = self.rand_date(0, 8)
        e1 = self.enc(fac, nik, doc, d0, d0 + timedelta(days=3), "IMP")
        self.line(enc_id=e1, fac=fac, nik=nik, doc=doc, drug=drug, d=d0 + timedelta(days=1), dose=21.0, qty=21, channel="INA-CBG", pkg=self.pkg())
        d2 = d0 + timedelta(days=int(self.rng.integers(36, 50)))
        if (d2 - CLAIM_START).days > CLAIM_DAYS - 1:
            return True
        e2 = self.enc(fac, nik, doc, d2)
        self.line(enc_id=e2, fac=fac, nik=nik, doc=doc, drug=drug, d=d2, dose=30.0, qty=30, channel="PRB")
        self.counters["refill_pasca_rawat_sah"] += 1
        return True

    # ---------------------------------------------------------------- fraud
    def fraud_phantom(self, fid: str | None = None) -> None:
        while True:
            fac = self.pick_fac(fraud=True)
            full_pool = self.nonstocked(fac, "Onkologi", "Albumin", "Alkes", min_price=400_000)
            part_pool = self.stocked(fac, "Onkologi", "Albumin", "Alkes", min_price=400_000)
            if full_pool and (self.rng.random() < 0.6 or not part_pool):
                variant, drug = "full", full_pool[int(self.rng.integers(len(full_pool)))]
            elif part_pool:
                variant, drug = "partial", part_pool[int(self.rng.integers(len(part_pool)))]
            else:
                continue
            break
        d, nik, doc = self.rand_date(), self.nik(), self.doctor(fac)
        eid = self.enc(fac, nik, doc, d)
        emit = variant == "full" and self.rng.random() < 0.35
        self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=drug, d=d, dose=float(drug.pack_size), qty=int(self.rng.integers(1, 7)),
                  channel=self.channel(drug), scenario="phantom", variant=variant, true_units=0, emit_med=emit, claim_id=fid)

    def fraud_inflate(self, fid: str | None = None) -> None:
        variant = str(self.rng.choice(["overt", "collusive", "subtle"], p=[0.58, 0.32, 0.10]))
        fac = self.pick_fac(fraud=True)
        if variant == "subtle":
            pool = self.stocked(fac, "PRB")
            drug = pool[int(self.rng.integers(len(pool)))]
            dose = float(self.rng.choice([56, 60, 84, 90]))
            qty = int(dose) + max(1, int(dose * drug.tol_pct))
            true = int(dose)
        elif variant == "collusive":
            pool = self.stocked(fac, "Onkologi", "Albumin") or self.stocked(fac, "Antibiotik")
            drug = pool[int(self.rng.integers(len(pool)))]
            dose = float(round(self.rng.integers(drug.dose_range[0], drug.dose_range[1] + 1) * self.rng.uniform(2.5, 3.5)))
            qty = expected_units(drug, dose); true = qty
        else:
            pool = self.stocked(fac, "Onkologi", "Albumin", "Antibiotik", "Alkes", "Infus") + self.stocked(fac, "PRB")[:2]
            drug = pool[int(self.rng.integers(len(pool)))]
            dose = self.dose_for(drug, legit_high=False)
            u = expected_units(drug, dose)
            k = int(self.rng.choice([2, 3, 4, 5], p=[0.30, 0.30, 0.25, 0.15]))
            qty = u * k if drug.category != "PRB" else int(dose) * min(k, 3)
            true = u if drug.category != "PRB" else int(dose)
        d, nik, doc = self.rand_date(), self.nik(), self.doctor(fac)
        eid = self.enc(fac, nik, doc, d)
        self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=drug, d=d, dose=dose, qty=qty, channel=self.channel(drug),
                  scenario="inflate", variant=variant, true_units=true, claim_id=fid)

    def fraud_duplicate(self, fid: str | None = None, variant: str | None = None, gap: int | None = None, fac: Facility | None = None) -> None:
        variant = variant or str(self.rng.choice(["package", "repeat"], p=[0.65, 0.35]))
        while True:
            fac = fac or self.pick_fac(fraud=True)
            prb = self.stocked(fac, "PRB")
            if prb:
                break
            fac = None
        drug = prb[int(self.rng.integers(len(prb)))]
        nik, doc = self.nik(), self.doctor(fac)
        dose = float(self.rng.choice([30, 56, 60]))
        if variant == "package":
            d0 = self.rand_date(0, CLAIM_DAYS - 16)
            e1 = self.enc(fac, nik, doc, d0, d0 + timedelta(days=3), "IMP")
            self.line(enc_id=e1, fac=fac, nik=nik, doc=doc, drug=drug, d=d0 + timedelta(days=1), dose=21.0, qty=21, channel="INA-CBG", pkg=self.pkg())
            d2 = d0 + timedelta(days=3 + int(self.rng.integers(1, 11)))
        else:
            d0 = self.rand_date(0, CLAIM_DAYS - 16)
            e1 = self.enc(fac, nik, doc, d0)
            self.line(enc_id=e1, fac=fac, nik=nik, doc=doc, drug=drug, d=d0, dose=dose, qty=int(dose), channel="PRB")
            d2 = d0 + timedelta(days=gap or int(self.rng.integers(4, 15)))
        e2 = self.enc(fac, nik, doc, d2)
        self.line(enc_id=e2, fac=fac, nik=nik, doc=doc, drug=drug, d=d2, dose=dose, qty=int(dose), channel="PRB",
                  scenario="duplicate", variant=variant, claim_id=fid)

    def fraud_no_visit(self, fid: str | None = None, fac: Facility | None = None, drug: Drug | None = None, variant: str | None = None) -> None:
        variant = variant or str(self.rng.choice(["missing", "mismatch", "date"], p=[0.5, 0.25, 0.25]))
        fac = fac or self.pick_fac(fraud=True)
        if drug is None:
            pool = self.stocked(fac, "Onkologi", "Albumin", "Alkes", "Antibiotik") or self.stocked(fac)
            drug = pool[int(self.rng.integers(len(pool)))]
        d, nik, doc = self.rand_date(0, CLAIM_DAYS - 36), self.nik(), self.doctor(fac)
        dose = self.dose_for(drug, legit_high=False)
        qty = expected_units(drug, dose)
        kw = dict(fac=fac, doc=doc, drug=drug, dose=dose, qty=qty, channel=self.channel(drug), scenario="no_visit", variant=variant, true_units=0, claim_id=fid)
        if variant == "missing":
            self.line(enc_id=f"ENC-NV-{self.seq['clm'] + 1:06d}", nik=nik, d=d, **kw)
        elif variant == "mismatch":
            other = self.nik()
            eid = self.enc(fac, other, doc, d)
            self.line(enc_id=eid, nik=nik, med_nik=other, d=d, **kw)
        else:
            eid = self.enc(fac, nik, doc, d)
            self.line(enc_id=eid, nik=nik, d=d, claim_date=d + timedelta(days=int(self.rng.integers(9, 31))), **kw)

    def showcase(self) -> dict[str, int]:
        """Kasus unggulan yang konsisten untuk demo (id CLM-DEMO-xx)."""
        f = FAC_BY_ID
        used = defaultdict(int)

        def at(day: int) -> date:
            return CLAIM_START + timedelta(days=day)

        # 1. Phantom + gelembung: Albumin 5 vial, pengadaan 0, RME 1 vial (RS-D tidak memasok Albumin 20%)
        fac = f["RS-D"]; drug = DRUG_BY_KFA["KFA-ALB-001"]; nik, doc = self.nik(), self.doctor(fac)
        eid = self.enc(fac, nik, doc, at(38))
        self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=drug, d=at(38), dose=100.0, qty=5, channel="Non-Paket", scenario="phantom",
                  variant="full", true_units=0, claim_id=SHOWCASE_PREFIX + "01", protected=True); used["phantom"] += 1
        # 2. Phantom: Trastuzumab 2 vial di RS Kelas C tanpa pengadaan maupun RME
        fac = f["RS-G"]; drug = DRUG_BY_KFA["KFA-ONC-002"]; nik, doc = self.nik(), self.doctor(fac)
        eid = self.enc(fac, nik, doc, at(41))
        self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=drug, d=at(41), dose=440.0, qty=2, channel="Non-Paket", scenario="phantom",
                  variant="full", true_units=0, emit_med=False, claim_id=SHOWCASE_PREFIX + "02", protected=True); used["phantom"] += 1
        # 3. Penggelembungan kuantitas: Paclitaxel dosis 130 mg (=2 vial wajar), diklaim 8 vial
        fac = f["RS-D"]; drug = DRUG_BY_KFA["KFA-ONC-001"]; nik, doc = self.nik(), self.doctor(fac)
        eid = self.enc(fac, nik, doc, at(44))
        self.line(enc_id=eid, fac=fac, nik=nik, doc=doc, drug=drug, d=at(44), dose=130.0, qty=8, channel="Non-Paket", scenario="inflate",
                  variant="overt", true_units=2, claim_id=SHOWCASE_PREFIX + "03", protected=True); used["inflate"] += 1
        # 6. Resep tanpa kunjungan: stent koroner di klinik kecil
        fac = f["RS-L"]; drug = DRUG_BY_KFA["KFA-ALK-001"]; nik, doc = self.nik(), self.doctor(fac)
        self.line(enc_id="ENC-NV-DEMO06", fac=fac, nik=nik, doc=doc, drug=drug, d=at(33), dose=1.0, qty=1, channel="Non-Paket",
                  scenario="no_visit", variant="missing", true_units=0, claim_id=SHOWCASE_PREFIX + "06", protected=True); used["no_visit"] += 1
        # 4 & 5. Penagihan ganda (paket vs PRB, dan refill berulang)
        n0 = len(self.lines)
        self.fraud_duplicate(fid=SHOWCASE_PREFIX + "04", variant="package", fac=f["RS-B"]); used["duplicate"] += 1
        self.fraud_duplicate(fid=SHOWCASE_PREFIX + "05", variant="repeat", gap=9, fac=f["RS-G"]); used["duplicate"] += 1
        for ln in self.lines[n0:]:
            ln.protected = True
        return dict(used)


def _build_procurement(world: _World, n: int, rng: np.random.Generator) -> pd.DataFrame:
    cadence = 7 if n >= 6000 else 14 if n >= 2500 else 28
    start_limit = CLAIM_START - timedelta(days=PO_LEAD_DAYS)
    use: dict[tuple, list] = defaultdict(list)
    for ln in world.lines:
        if ln.use:
            fac, kfa, d, units = ln.use
            use[(fac, kfa)].append((d, units))
    rows: list[dict] = []
    seq = 0
    for (fac, kfa), items in sorted(use.items()):
        drug = DRUG_BY_KFA[kfa]
        buckets: dict[int, int] = defaultdict(int)
        for d, units in items:
            buckets[(d - CLAIM_START).days // cadence] += units
        for w, total in sorted(buckets.items()):
            qty = max(total, math.ceil(total * (1 + rng.uniform(0.02, 0.15))))   # penyangga stok 2-15%
            po_date = max(start_limit, CLAIM_START + timedelta(days=w * cadence) - timedelta(days=int(rng.integers(0, 3))))
            r = rng.random()
            if r < 0.07:
                delay = int(rng.integers(1, 15)); world.counters["faktur_terlambat_dalam_tenggang"] += 1
            elif r < 0.082:
                delay = int(rng.integers(15, 31)); world.counters["faktur_terlambat_lewat_tenggang"] += 1
            else:
                delay = int(rng.integers(0, 2))
            off = rng.random() < 0.08
            if off:
                world.counters["pembelian_non_ekatalog_sah"] += 1
            seq += 1
            rows.append({
                "procurement_id": f"PO-{seq:07d}", "facility_id": fac, "supplier": "Distributor Lokal Sintetis" if off else str(rng.choice(SUPPLIERS)),
                "drug_name": _name(rng, drug, "procurement", world.counters), "qty": int(qty),
                "unit_price": int(round(drug.unit_price * rng.uniform(0.93, 1.07))),
                "purchase_date": po_date.isoformat(), "invoice_no": f"INV-{seq:07d}",
                "invoice_input_date": (po_date + timedelta(days=delay)).isoformat(),
                "channel": "Non e-Katalog" if off else "e-Katalog",
            })
    # Pecah baris acak (berbobot qty) agar jumlah baris = target n (jika memungkinkan)
    if len(rows) < n:
        guard = 0
        while len(rows) < n and guard < n * 40:
            guard += 1
            weights = np.array([max(r["qty"] - 1, 0) for r in rows], dtype=float)
            if weights.sum() == 0:
                break
            batch = min(n - len(rows), 600)
            picks = rng.choice(len(rows), size=batch, replace=False, p=weights / weights.sum()) if weights.astype(bool).sum() >= batch else []
            if len(picks) == 0:
                break
            for i in picks:
                r = rows[int(i)]
                if r["qty"] < 2:
                    continue
                a = int(rng.integers(1, r["qty"]))
                seq += 1
                new = dict(r); new["qty"] = r["qty"] - a; new["procurement_id"] = f"PO-{seq:07d}"
                r["qty"] = a
                rows.append(new)
    df = pd.DataFrame(rows)
    if len(df) > n:                       # n kecil: cadence minimum tetap menghasilkan > n baris; jujur dilaporkan di meta
        world.counters["procurement_melebihi_target"] = len(df) - n
    return df.sample(frac=1.0, random_state=int(rng.integers(0, 2**31 - 1))).reset_index(drop=True) if len(df) else df


def _rme_bundle(world: _World, n: int, rng: np.random.Generator) -> dict:
    meds = [ln.med for ln in world.lines if ln.med]
    encs = list(world.encs)
    pad = max(0, n - len(meds))
    # Pengisi: pemberian obat non-JKN agar jumlah record RME = target (diberi label payer=NON-JKN)
    for _ in range(pad):
        fac = world.pick_fac()
        pool = world.stocked(fac)
        drug = pool[int(rng.integers(len(pool)))]
        d, nik, doc = world.rand_date(), world.nik(), world.doctor(fac)
        world.seq["enc"] += 1
        eid = f"ENC-{world.seq['enc']:07d}"
        encs.append({"id": eid, "fac": fac.id, "nik": nik, "doc": doc, "start": d, "end": d, "cls": "AMB", "payer": "NON-JKN"})
        world.seq["med"] += 1
        dose = world.dose_for(drug, legit_high=False)
        meds.append({"id": f"MA-{world.seq['med']:07d}", "enc": eid, "nik": nik, "doc": doc, "fac": fac.id, "name": _name(rng, drug, "rme", world.counters),
                     "date": d, "dose": float(dose), "unit": drug.dose_unit, "payer": "NON-JKN"})
    entries = []
    for e in encs:
        entries.append({"resource": {
            "resourceType": "Encounter", "id": e["id"], "status": "finished", "class": {"code": e["cls"]},
            "subject": {"identifier": {"system": "urn:nik", "value": e["nik"]}},
            "participant": [{"individual": {"identifier": {"system": "urn:practitioner", "value": e["doc"]}}}],
            "serviceProvider": {"identifier": {"value": e["fac"]}},
            "period": {"start": e["start"].isoformat(), "end": e["end"].isoformat()},
            "extension": [{"url": "payer", "valueString": e["payer"]}]}})
    for m in meds:
        entries.append({"resource": {
            "resourceType": "MedicationAdministration", "id": m["id"], "status": "completed",
            "context": {"reference": f"Encounter/{m['enc']}"},
            "subject": {"identifier": {"system": "urn:nik", "value": m["nik"]}},
            "performer": [{"actor": {"identifier": {"system": "urn:practitioner", "value": m["doc"]}}}],
            "location": {"identifier": {"value": m["fac"]}},
            "medicationCodeableConcept": {"text": m["name"]},
            "effectiveDateTime": m["date"].isoformat(),
            "dosage": {"dose": {"value": m["dose"], "unit": m["unit"]}},
            "extension": [{"url": "payer", "valueString": m["payer"]}]}})
    return {"resourceType": "Bundle", "type": "collection", "entry": entries}


def generate_bundle(records: int = 10_000, seed: int = 20261011, fraud_rate: float = 0.15, showcase: bool = True) -> SyntheticBundle:
    """Bangkitkan data 3 pintu. Deterministik untuk (records, seed, fraud_rate, showcase)."""
    if records < 200:
        raise ValueError("records minimal 200 agar distribusi dan skenario fraud bermakna")
    rng = np.random.default_rng(seed)
    w = _World(rng, fraud_rate)

    target_fraud = int(round(records * fraud_rate))
    plan = {k: int(round(target_fraud * v)) for k, v in SCENARIO_SHARE.items()}
    plan["phantom"] += target_fraud - sum(plan.values())
    if showcase:
        for k, v in w.showcase().items():
            plan[k] = max(0, plan[k] - v)
    makers = {"phantom": w.fraud_phantom, "inflate": w.fraud_inflate, "duplicate": w.fraud_duplicate, "no_visit": w.fraud_no_visit}
    for scen, count in plan.items():
        for _ in range(count):
            makers[scen]()

    kinds = ["kemo", "prb", "inpatient", "alkes", "post"]
    kind_p = np.array([0.075, 0.43, 0.285, 0.09, 0.02]); kind_p /= kind_p.sum()
    visit = {"kemo": w.visit_kemo, "prb": w.visit_prb, "inpatient": w.visit_inpatient, "alkes": w.visit_alkes, "post": w.visit_post_discharge_legit}
    while len(w.lines) < records:
        fac = w.pick_fac()
        visit[str(rng.choice(kinds, p=kind_p))](fac)
    while len(w.lines) > records:             # pangkas kelebihan dari baris normal terakhir (bukan fraud/showcase)
        idx = max(i for i, ln in enumerate(w.lines) if ln.label["label_fraud"] == 0 and not ln.protected)
        w.lines.pop(idx)

    claims = pd.DataFrame([ln.claim for ln in w.lines]).sample(frac=1.0, random_state=seed).reset_index(drop=True)
    labels = pd.DataFrame([ln.label for ln in w.lines])
    procurement = _build_procurement(w, records, rng)
    rme = _rme_bundle(w, records, rng)
    n_med = sum(1 for e in rme["entry"] if e["resource"]["resourceType"] == "MedicationAdministration")
    meta = {
        "seed": seed, "target_records": records, "fraud_rate_target": fraud_rate,
        "actual": {"procurement": len(procurement), "rme_medication_administration": n_med, "claims": len(claims)},
        "rme_filler_non_jkn": int(max(0, records - sum(1 for ln in w.lines if ln.med))),
        "scenario_counts": labels[labels.label_fraud == 1].scenario.value_counts().to_dict(),
        "variant_counts": labels[labels.label_fraud == 1].groupby(["scenario", "variant"]).size().rename("n").reset_index().to_dict("records"),
        "fraud_lines": int(labels.label_fraud.sum()),
        "traps": dict(w.counters),
        "showcase_ids": [ln.claim["claim_id"] for ln in w.lines if ln.claim["claim_id"].startswith(SHOWCASE_PREFIX)],
        "label": "Data Sintetis",
    }
    return SyntheticBundle(procurement, rme, claims, labels, meta)
