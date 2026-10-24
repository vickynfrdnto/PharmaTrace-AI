"""Orkestrasi audit sebagai job latar belakang dengan progres NYATA per tahap (waktu diukur, bukan simulasi)."""
from __future__ import annotations

import gc
import io
import json
import threading
import time
import uuid
from collections import OrderedDict

import numpy as np
import pandas as pd

from .config import get_settings
from .db import ClaimResult, Decision, EvalLabel, RandomMeta, RandomReview, RandomSample, Run, SessionLocal, Trail, now
from .engine import STAGES, EngineConfig, run_engine
from .generator import generate_bundle
from .ingest import IngestError, ingest, read_csv_bytes, read_rme_bytes
from .security import log_trail

JOB_STAGES = [("load", "Memuat data 3 pintu"), ("privacy", "Pseudonimisasi NIK & ID dokter (HMAC-SHA-256)"), *STAGES, ("save", "Menyimpan hasil audit (pseudonim)")]
JOBS: dict[str, dict] = {}
RUN_CACHE: "OrderedDict[str, dict]" = OrderedDict()   # model + fitur per run untuk SHAP on-demand (tidak memuat data mentah)
KEEP_RUNS = 4
_lock = threading.Lock()
RULE_COLS = [("rule_stock", "Neraca stok"), ("rule_rme_missing", "RME tidak mencatat pemberian"), ("rule_pos_excess", "Posologi melebihi dosis RME"),
             ("adm_missing", "Resep tanpa kunjungan"), ("adm_patient", "Pasien tidak cocok dengan kunjungan"), ("adm_facility", "Faskes tidak cocok"),
             ("adm_date", "Tanggal di luar periode kunjungan"), ("pkg_dup", "Duplikasi paket INA-CBG vs PRB"), ("repeat_billing", "Refill berulang"),
             ("unmapped", "Nama obat tidak terpetakan"), ("ml_only", "Anomali ML (lolos aturan)")]


def new_job(actor: str, role: str = "Admin") -> dict:
    job = {"id": uuid.uuid4().hex[:12], "status": "queued", "actor": actor, "role": role, "created": time.time(), "run_id": None, "error": None, "problems": [],
           "stages": [{"key": k, "label": lbl, "status": "pending", "seconds": None} for k, lbl in JOB_STAGES], "progress": 0.0, "total_seconds": None,
           "process_seconds": None}
    with _lock:
        JOBS[job["id"]] = job
        for old in list(JOBS)[:-30]:
            JOBS.pop(old, None)
    return job


def _mark(job: dict, key: str, state: str, seconds: float | None = None) -> None:
    for s in job["stages"]:
        if s["key"] == key:
            s["status"], s["seconds"] = ("running" if state == "start" else "done"), seconds
    job["progress"] = sum(1 for s in job["stages"] if s["status"] == "done") / len(job["stages"])


def start_job(job: dict, kind: str, params: dict, upload: dict | None = None) -> None:
    threading.Thread(target=_run, args=(job, kind, params, upload), daemon=True).start()


def _parse_labels(data: bytes | None) -> pd.DataFrame | None:
    if not data:
        return None
    df = read_csv_bytes(data, "label (opsional)")
    if not {"claim_id", "label_fraud"} <= set(df.columns):
        raise IngestError("File label harus memiliki kolom claim_id dan label_fraud.")
    df["claim_id"] = df["claim_id"].astype(str).str.strip()
    if df["claim_id"].eq("").any() or df["claim_id"].duplicated().any():
        raise IngestError("claim_id pada file label harus terisi dan unik.")
    values = pd.to_numeric(df["label_fraud"], errors="coerce")
    if values.isna().any() or not values.isin([0, 1]).all():
        raise IngestError("label_fraud harus berisi angka 0 atau 1 saja.")
    df["label_fraud"] = values.astype("int8")
    for col in ("scenario", "variant"):
        if col not in df.columns:
            df[col] = ""
    return df[["claim_id", "label_fraud", "scenario", "variant"]]


def _run(job: dict, kind: str, params: dict, upload: dict | None) -> None:
    st = get_settings()
    t_start = time.perf_counter()
    job["status"] = "running"
    try:
        # ---- 1. load
        _mark(job, "load", "start"); t0 = time.perf_counter()
        meta, gen_seconds = {}, None
        if kind == "synthetic":
            bundle = generate_bundle(params["records"], params["seed"], showcase=params.get("showcase", True))
            proc_df, claims_df, rme, labels, meta = bundle.procurement, bundle.claims, bundle.rme, bundle.labels, bundle.meta
            gen_seconds = time.perf_counter() - t0
        else:
            proc_df = read_csv_bytes(upload["procurement"], "e-Katalog/ERP (Pintu 1)")
            rme = read_rme_bytes(upload["rme"])
            claims_df = read_csv_bytes(upload["claims"], "Klaim VEDIKA (Pintu 3)")
            labels = _parse_labels(upload.get("labels"))
            if labels is not None:
                claim_ids = set(claims_df.get("claim_id", pd.Series(dtype=str)).astype(str).str.strip())
                unknown = sorted(set(labels["claim_id"]) - claim_ids)
                if unknown:
                    raise IngestError(
                        "File label berisi claim_id yang tidak ditemukan pada file klaim.",
                        [f"{len(unknown)} ID tidak cocok (contoh: {', '.join(unknown[:5])})."],
                    )
        _mark(job, "load", "end", time.perf_counter() - t0)

        # ---- 2. privasi: pseudonimisasi sebelum analitik, data mentah dibuang
        _mark(job, "privacy", "start"); t0 = time.perf_counter()
        ing = ingest(proc_df, claims_df, rme, st.hmac_secret)
        del proc_df, claims_df, rme
        if kind == "synthetic":
            del bundle
        gc.collect()
        privacy_s = time.perf_counter() - t0
        _mark(job, "privacy", "end", privacy_s)

        # ---- 3. engine
        cfg = EngineConfig(grace_days=params.get("grace_days", st.grace_period_days), di_threshold=params.get("di_threshold", st.di_threshold),
                           heatmap_threshold_pct=params.get("threshold_pct", st.heatmap_threshold_pct), repeat_min_days=st.repeat_refill_min_days,
                           package_window_days=st.package_window_days, sample_pct=params.get("sample_pct", st.audit_sample_pct), seed=params.get("seed", st.random_seed))

        def on_stage(key: str, state: str, seconds: float | None) -> None:
            _mark(job, key, state, seconds)

        res = run_engine(ing, cfg, labels, on_stage, target_records=params.get("records"))
        process_seconds = privacy_s + res.summary["process_seconds"]
        res.summary["process_seconds"] = float(process_seconds)
        res.summary["stage_seconds"] = {"privacy": privacy_s, **res.summary["stage_seconds"]}
        res.summary["generate_seconds"] = gen_seconds

        # ---- 4. simpan
        _mark(job, "save", "start"); t0 = time.perf_counter()
        run_id = uuid.uuid4().hex[:10]
        _save(run_id, job["actor"], job["role"], kind, params, ing, res, labels, meta)
        save_s = time.perf_counter() - t0
        _mark(job, "save", "end", save_s)
        RUN_CACHE[run_id] = {"model": res.model, "X": res.X, "index": {cid: i for i, cid in enumerate(res.claims["claim_id"])}}
        while len(RUN_CACHE) > KEEP_RUNS:
            RUN_CACHE.popitem(last=False)
        job.update(status="done", run_id=run_id, process_seconds=process_seconds, total_seconds=time.perf_counter() - t_start)
    except IngestError as exc:
        job.update(status="error", error=exc.message, problems=exc.problems)
    except Exception as exc:  # noqa: BLE001
        job.update(status="error", error=f"Audit gagal: {type(exc).__name__}: {exc}")


def _save(run_id: str, actor: str, role: str, kind: str, params: dict, ing, res, labels, meta: dict) -> None:
    c = res.claims
    flags_cols = [(col, name, c[col].to_numpy(bool)) for col, name in RULE_COLS]
    active = (c["flagged"] | c["waiting"]).to_numpy()
    rows = []
    for i, r in enumerate(c.itertuples(index=False)):
        names = [name for _, name, arr in flags_cols if arr[i]] if active[i] else []
        rows.append({
            "id": f"{run_id}:{r.claim_id}", "run_id": run_id, "claim_id": r.claim_id, "facility_id": r.facility_id, "facility_name": r.facility_name,
            "peer_class": r.peer_class, "category": r.category, "kfa": r.kfa if isinstance(r.kfa, str) else None, "generic": r.generic, "unit": r.unit,
            "channel": r.claim_channel, "service_date": r.service_date.date().isoformat(), "qty": float(r.qty), "rme_expected": float(r.rme_expected),
            "rme_found": bool(r.rme_found), "slack": float(r.slack_grace), "proc_cell_total": float(r.proc_cell_total), "unit_price": float(r.unit_price),
            "amount": float(r.amount), "potential_difference": float(r.potential_difference) if r.flagged else 0.0, "held_value": float(r.held_value),
            "di": float(r.di), "rule_part": float(r.rule_part), "ml_part": float(r.ml_part), "fin_part": float(r.fin_part), "rule_score": float(r.rule_score),
            "ml_score": float(r.ml_score), "flagged": bool(r.flagged), "waiting": bool(r.waiting and not r.flagged), "status": r.status, "priority": r.priority,
            "primary_rule": r.primary_rule, "rule_flags": json.dumps(names), "reason": r.reason, "recommendation": r.recommendation,
            "shap_json": json.dumps(r.shap) if r.shap else "[]", "pid": r.pid, "did": r.did})
    db = SessionLocal()
    try:
        db.add(Run(id=run_id, created_by=actor, source="sintetis" if kind == "synthetic" else "upload", params_json=json.dumps(params), summary_json=json.dumps(res.summary),
                   metrics_json=json.dumps(res.metrics) if res.metrics else None, heatmap_json=json.dumps(res.heatmap),
                   validation_json=json.dumps(res.validation), privacy_json=json.dumps({**ing.privacy, "raw_purged_after_ingest": True, "purged_at": now().isoformat(timespec="seconds")}),
                   meta_json=json.dumps(meta, default=str), has_labels=res.metrics is not None))
        db.bulk_insert_mappings(ClaimResult, rows)
        if labels is not None and len(labels):
            lab = labels.drop_duplicates("claim_id")
            db.bulk_insert_mappings(EvalLabel, [{"run_id": run_id, "claim_id": r.claim_id, "label_fraud": int(r.label_fraud), "scenario": str(r.scenario), "variant": str(r.variant)}
                                                for r in lab.itertuples()])
        db.bulk_insert_mappings(RandomSample, [{"run_id": run_id, "claim_id": cid, "draw_no": 1} for cid in res.sample_ids])
        db.add(RandomMeta(run_id=run_id, draw_no=1, pct=float(params.get("sample_pct", get_settings().audit_sample_pct)), seed=int(params.get("seed", get_settings().random_seed))))
        db.commit()
        _cleanup(db)
        log_trail(db, actor, role, "JALANKAN_AUDIT", run_id=run_id,
                  detail=f"sumber={kind}; records={res.summary['records']}; flagged={res.summary['flagged']}; process={res.summary['process_seconds']:.2f}s")
    finally:
        db.close()


def _cleanup(db) -> None:
    runs = db.query(Run).order_by(Run.created_at.desc()).all()
    for old in runs[KEEP_RUNS:]:
        rid = old.id
        for model in (ClaimResult, EvalLabel, RandomSample, RandomMeta, RandomReview):
            db.query(model).filter(model.run_id == rid).delete(synchronize_session=False)
        db.query(Decision).filter(Decision.claim_key.like(f"{rid}:%")).delete(synchronize_session=False)
        db.delete(old)
    db.commit()


def scrub_legacy_privacy_examples() -> int:
    """Hapus contoh pengenal mentah dari hasil lama sebelum API mulai melayani permintaan."""
    db = SessionLocal()
    changed = 0
    try:
        for run in db.query(Run).filter(Run.privacy_json.is_not(None)).all():
            try:
                privacy = json.loads(run.privacy_json)
            except (TypeError, json.JSONDecodeError):
                continue
            changed_run = False
            if isinstance(privacy, dict):
                changed_run = privacy.pop("example", None) is not None
                for entry in privacy.values():
                    if isinstance(entry, dict) and "before" in entry and "after" in entry:
                        entry.pop("before", None)
                        changed_run = True
            if changed_run:
                run.privacy_json = json.dumps(privacy)
                changed += 1
        if changed:
            db.commit()
        return changed
    finally:
        db.close()
