"""PharmaTrace-AI API (FastAPI). Semua data = SINTETIS kecuali pengguna mengunggah berkasnya sendiri."""
from __future__ import annotations

import csv
import io
import json
import math
import os
from functools import lru_cache

import numpy as np
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from . import jobs, workflow
from .config import get_settings
from .db import ClaimResult, Decision, RandomMeta, RandomReview, RandomSample, Run, Trail, get_db, init_db, now
from .engine import FEATURES, W_FIN, W_ML, W_RULE, draw_sample, shap_single
from .generator import generate_bundle
from .master import CATEGORIES, FACILITIES
from .privacy import demo_before_after, key_fingerprint
from .security import ROLE_MATRIX, USERS, current_user, log_trail, login, require, verify_chain

init_db()
jobs.scrub_legacy_privacy_examples()
app = FastAPI(title="PharmaTrace-AI API", version="1.0.0", description="Engine audit triangulasi klaim obat & alkes. Data sintetis.")
allowed_origins = [origin.strip() for origin in os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if origin.strip()]
if os.getenv("APP_ENV", "development").strip().lower() in {"production", "prod"}:
    settings = get_settings()
    token_secret = os.getenv("TOKEN_SECRET", "")
    weak_markers = ("ganti", "change-me", "changeme", "example", "placeholder")
    if settings.secret_is_default or len(settings.hmac_secret) < 32 or any(x in settings.hmac_secret.lower() for x in weak_markers):
        raise RuntimeError("Production requires a unique HMAC_SECRET of at least 32 characters.")
    if len(token_secret) < 32 or token_secret == settings.hmac_secret or any(x in token_secret.lower() for x in weak_markers):
        raise RuntimeError("Production requires a distinct TOKEN_SECRET of at least 32 characters.")
    if not os.getenv("CORS_ORIGINS") or not allowed_origins or "*" in allowed_origins:
        raise RuntimeError("Production requires explicit frontend origins in CORS_ORIGINS.")
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------ util
def _run(db: Session, run_id: str) -> Run:
    q = db.query(Run)
    run = q.order_by(Run.created_at.desc()).first() if run_id == "latest" else q.filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(404, "Belum ada audit. Jalankan audit terlebih dahulu (Upload & Audit).")
    return run


def _scope(q, user: dict):
    return q.filter(ClaimResult.facility_id.in_(user["facilities"])) if user.get("facilities") is not None else q


def _visible_summary(db: Session, run_id: str, user: dict) -> dict:
    q = _scope(db.query(ClaimResult).filter(ClaimResult.run_id == run_id), user)
    row = q.with_entities(
        func.count(ClaimResult.id),
        func.coalesce(func.sum(case((ClaimResult.flagged.is_(True), 1), else_=0)), 0),
        func.coalesce(func.sum(case((ClaimResult.waiting.is_(True), 1), else_=0)), 0),
        func.coalesce(func.sum(ClaimResult.potential_difference), 0.0),
        func.coalesce(func.sum(ClaimResult.held_value), 0.0),
        func.coalesce(func.sum(ClaimResult.amount), 0.0),
        func.coalesce(func.sum(case((ClaimResult.priority == "Tinggi", 1), else_=0)), 0),
        func.count(func.distinct(ClaimResult.facility_id)),
        func.coalesce(func.sum(case((ClaimResult.flagged.is_(True) & (ClaimResult.primary_rule != "ML saja"), 1), else_=0)), 0),
        func.coalesce(func.sum(case((ClaimResult.primary_rule == "ML saja", 1), else_=0)), 0),
    ).one()
    records, flagged, waiting, difference, held, amount, high_priority, facilities, rule_flagged, ml_only = row
    sample_query = db.query(func.count(RandomSample.claim_id)).join(
        ClaimResult, (ClaimResult.run_id == RandomSample.run_id) & (ClaimResult.claim_id == RandomSample.claim_id)
    ).filter(RandomSample.run_id == run_id)
    sample_size = sample_query.filter(ClaimResult.facility_id.in_(user["facilities"])).scalar() if user.get("facilities") is not None else sample_query.scalar()
    sample_size = sample_size or 0
    return {"records": int(records), "flagged": int(flagged), "flagged_pct": float(flagged / records * 100) if records else 0.0,
            "waiting_invoice": int(waiting), "potential_difference": float(difference), "held_value": float(held),
            "claim_value_total": float(amount), "high_priority": int(high_priority), "facilities": int(facilities),
            "rule_flagged": int(rule_flagged), "ml_only_flagged": int(ml_only), "sample_size": int(sample_size)}


def _loads(s: str | None, default=None):
    return json.loads(s) if s else default


def _num(x: float) -> float | int:
    return int(round(x)) if abs(x - round(x)) < 1e-9 else round(float(x), 1)


def _card(r: ClaimResult, state: str | None = None) -> dict:
    return {"key": r.id, "claim_id": r.claim_id, "facility_id": r.facility_id, "facility_name": r.facility_name, "peer_class": r.peer_class,
            "category": r.category, "generic": r.generic, "unit": r.unit, "service_date": r.service_date, "qty": _num(r.qty), "di": r.di,
            "status": r.status, "priority": r.priority, "primary_rule": r.primary_rule, "potential_difference": r.potential_difference,
            "amount": r.amount, "reason": r.reason, "rule_flags": _loads(r.rule_flags, []), "decision_state": state or workflow.INITIAL}


def _states(db: Session, keys: list[str]) -> dict[str, str]:
    if not keys:
        return {}
    return {d.claim_key: d.state for d in db.query(Decision).filter(Decision.claim_key.in_(keys)).all()}


def _wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


# ------------------------------------------------------------------ umum & auth
@app.get("/api/health")
def health():
    return {"ok": True, "app": "PharmaTrace-AI", "data_policy": "Data Sintetis"}


@app.get("/api/config")
def config():
    s = get_settings()
    return {"data_label": "Data Sintetis", "heatmap_threshold_pct": s.heatmap_threshold_pct, "grace_period_days": s.grace_period_days,
            "audit_sample_pct": s.audit_sample_pct, "di_threshold": s.di_threshold, "default_records": s.default_records, "max_records": s.max_records,
            "default_seed": s.random_seed, "categories": CATEGORIES, "facilities": [{"id": f.id, "name": f.name, "klass": f.klass} for f in FACILITIES],
            "di_weights": {"rule": W_RULE, "ml": W_ML, "financial": W_FIN}, "features": FEATURES, "decision_actions": workflow.ALL_ACTIONS}


class LoginIn(BaseModel):
    username: str
    password: str


@app.get("/api/auth/demo-users")
def demo_users():
    # Endpoint ini hanya untuk akun demo lokal; kredensial bukan mekanisme autentikasi produksi.
    return [{"username": k, "role": v["role"], "name": v["name"], "password": v["password"], "facilities": v["facilities"]} for k, v in USERS.items()]


@app.post("/api/auth/login")
def do_login(body: LoginIn, db: Session = Depends(get_db)):
    res = login(body.username, body.password)
    if not res:
        raise HTTPException(401, "Nama pengguna atau kata sandi salah.")
    log_trail(db, body.username, res["user"]["role"], "LOGIN")
    return res


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user)):
    return {k: user[k] for k in ("username", "role", "name", "facilities")}


# ------------------------------------------------------------------ dataset sintetis & audit
@lru_cache(maxsize=2)
def _bundle(records: int, seed: int, showcase: bool):
    return generate_bundle(records, seed, showcase=showcase)


@app.get("/api/datasets/synthetic/{name}")
def download_dataset(name: str, records: int = 10000, seed: int = 20261011, showcase: bool = True, user: dict = Depends(require("Supervisor", "Admin"))):
    if not 200 <= records <= get_settings().max_records:
        raise HTTPException(422, f"records harus 200–{get_settings().max_records}")
    b = _bundle(records, seed, showcase)
    if name == "procurement.csv":
        return Response(b.procurement.to_csv(index=False), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=procurement.csv"})
    if name == "claims.csv":
        return Response(b.claims.to_csv(index=False), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=claims.csv"})
    if name == "labels.csv":
        return Response(b.labels.to_csv(index=False), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=labels.csv"})
    if name == "rme.json":
        return Response(json.dumps(b.rme), media_type="application/json", headers={"Content-Disposition": "attachment; filename=rme.json"})
    raise HTTPException(404, "Nama berkas tidak dikenal (procurement.csv, rme.json, claims.csv, labels.csv).")


class AuditIn(BaseModel):
    records: int = Field(10000, ge=200)
    seed: int = 20261011
    showcase: bool = True
    threshold_pct: float = Field(20.0, ge=1, le=100)
    di_threshold: float = Field(20.0, ge=0, le=100)
    sample_pct: float = Field(5.0, ge=1, le=50)


@app.post("/api/audit/run", status_code=202)
def audit_run(body: AuditIn, user: dict = Depends(require("Supervisor", "Admin"))):
    if body.records > get_settings().max_records:
        raise HTTPException(422, f"records maksimum {get_settings().max_records} pada konfigurasi ini.")
    job = jobs.new_job(user["username"], user["role"])
    jobs.start_job(job, "synthetic", body.model_dump())
    return {"job_id": job["id"]}


@app.post("/api/audit/upload", status_code=202)
async def audit_upload(procurement_file: UploadFile = File(...), rme_file: UploadFile = File(...), claims_file: UploadFile = File(...),
                       labels_file: UploadFile | None = File(None), threshold_pct: float = Form(20.0), di_threshold: float = Form(20.0), sample_pct: float = Form(5.0),
                       user: dict = Depends(require("Supervisor", "Admin"))):
    max_upload_bytes = 100 * 1024 * 1024
    upload, total_bytes = {}, 0
    for key, file in (("procurement", procurement_file), ("rme", rme_file), ("claims", claims_file), ("labels", labels_file)):
        if file is None:
            continue
        remaining = max_upload_bytes - total_bytes
        content = await file.read(remaining + 1)
        if len(content) > remaining:
            raise HTTPException(413, "Ukuran total unggahan melebihi batas 100 MiB.")
        upload[key] = content
        total_bytes += len(content)
    job = jobs.new_job(user["username"], user["role"])
    jobs.start_job(job, "upload", {"threshold_pct": threshold_pct, "di_threshold": di_threshold, "sample_pct": sample_pct, "seed": get_settings().random_seed}, upload)
    return {"job_id": job["id"]}


@app.get("/api/audit/jobs/{job_id}")
def job_status(job_id: str, user: dict = Depends(current_user)):
    job = jobs.JOBS.get(job_id)
    if not job or job["actor"] != user["username"]:
        raise HTTPException(404, "Job tidak ditemukan.")
    return {k: job[k] for k in ("id", "status", "stages", "progress", "run_id", "error", "problems", "total_seconds", "process_seconds")}


# ------------------------------------------------------------------ run
@app.get("/api/runs")
def runs(db: Session = Depends(get_db), user: dict = Depends(current_user)):
    out = []
    for r in db.query(Run).order_by(Run.created_at.desc()).all():
        s = _loads(r.summary_json, {})
        visible = _visible_summary(db, r.id, user) if user.get("facilities") is not None else s
        out.append({"id": r.id, "created_at": r.created_at.isoformat(timespec="seconds"), "source": r.source, "records": visible.get("records"), "flagged": visible.get("flagged"), "has_labels": r.has_labels})
    return out


@app.get("/api/runs/{run_id}")
def run_summary(run_id: str, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    r = _run(db, run_id)
    summary = _loads(r.summary_json, {})
    if user.get("facilities") is not None:
        summary.update(_visible_summary(db, r.id, user))
        summary["stage_seconds"] = {}
        summary["process_seconds"] = None
        summary["generate_seconds"] = None
        summary["shap_status"] = ""
    return {"id": r.id, "created_at": r.created_at.isoformat(timespec="seconds"), "created_by": r.created_by if user.get("facilities") is None else None, "source": r.source, "params": _loads(r.params_json),
            "summary": summary, "meta": _loads(r.meta_json, {}) if user.get("facilities") is None else {}, "privacy": _loads(r.privacy_json) if user.get("facilities") is None else None, "has_labels": r.has_labels,
            "data_label": "Data Sintetis" if r.source == "sintetis" else "Berkas unggahan pengguna"}


@app.get("/api/runs/{run_id}/heatmap")
def heatmap(run_id: str, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    r = _run(db, run_id)
    cells = _loads(r.heatmap_json, [])
    if user.get("facilities") is not None:
        cells = [c for c in cells if c["facility_id"] in user["facilities"]]
    return {"run_id": r.id, "categories": CATEGORIES, "cells": cells, "default_threshold_pct": get_settings().heatmap_threshold_pct,
            "metric": "selisih nilai klaim terhadap nilai pengadaan (%), hanya jika klaim > pengadaan"}


@app.get("/api/runs/{run_id}/validation")
def validation(run_id: str, db: Session = Depends(get_db), user: dict = Depends(require("Supervisor", "Admin"))):
    r = _run(db, run_id)
    return {"run_id": r.id, "validation": _loads(r.validation_json), "generator": _loads(r.meta_json, {}), "source": r.source}


# ------------------------------------------------------------------ klaim
@app.get("/api/runs/{run_id}/claims")
def list_claims(run_id: str, status: str | None = None, facility: str | None = None, category: str | None = None, min_di: float = 0, flagged_only: bool = False,
                q: str | None = None, sort: str = "di", limit: int = Query(50, le=500), offset: int = 0, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    run = _run(db, run_id)
    query = _scope(db.query(ClaimResult).filter(ClaimResult.run_id == run.id), user)
    if flagged_only:
        query = query.filter(ClaimResult.flagged.is_(True))
    if status:
        query = query.filter(ClaimResult.status == status)
    if facility:
        query = query.filter(ClaimResult.facility_id == facility)
    if category:
        query = query.filter(ClaimResult.category == category)
    if min_di:
        query = query.filter(ClaimResult.di >= min_di)
    if q:
        query = query.filter(ClaimResult.claim_id.like(f"%{q}%") | ClaimResult.generic.like(f"%{q}%"))
    total = query.count()
    order = {"di": ClaimResult.di.desc(), "potential": ClaimResult.potential_difference.desc(), "date": ClaimResult.service_date.asc()}.get(sort, ClaimResult.di.desc())
    rows = query.order_by(order, ClaimResult.claim_id).offset(offset).limit(limit).all()
    st = _states(db, [r.id for r in rows])
    return {"run_id": run.id, "total": total, "items": [_card(r, st.get(r.id)) for r in rows]}


@app.get("/api/claims/{key}")
def claim_detail(key: str, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    r = db.get(ClaimResult, key)
    if not r or (user.get("facilities") is not None and r.facility_id not in user["facilities"]):
        raise HTTPException(404, "Klaim tidak ditemukan atau di luar penugasan Anda.")
    shap_list = _loads(r.shap_json, [])
    if not shap_list and (r.flagged or r.waiting):
        cache = jobs.RUN_CACHE.get(r.run_id)
        if cache and r.claim_id in cache["index"]:
            try:
                shap_list = shap_single(cache["model"], cache["X"], cache["index"][r.claim_id])
                r.shap_json = json.dumps(shap_list); db.commit()
            except Exception:  # noqa: BLE001
                shap_list = []
    dec = db.get(Decision, key)
    state = dec.state if dec else workflow.INITIAL
    log_trail(db, user["username"], user["role"], "BUKA_KLAIM", run_id=r.run_id, claim_key=key)
    hist = db.query(Trail).filter(Trail.claim_key == key).order_by(Trail.id.asc()).all()
    out = _card(r, state)
    out.update({
        "three_doors": {"ekatalog": {"available_stock": _num(max(r.slack, 0)), "cell_total": _num(r.proc_cell_total)},
                        "rme": {"expected": _num(r.rme_expected), "found": r.rme_found}, "klaim": {"qty": _num(r.qty)}},
        "di_breakdown": {"rule": r.rule_part, "ml": r.ml_part, "financial": r.fin_part, "weights": {"rule": W_RULE, "ml": W_ML, "financial": W_FIN}},
        "rule_score": r.rule_score, "ml_score": r.ml_score, "recommendation": r.recommendation, "unit_price": r.unit_price, "held_value": r.held_value,
        "channel": r.channel, "pseudonym_patient": r.pid, "pseudonym_doctor": r.did, "shap": shap_list,
        "decision": {"state": state, "last_action": dec.decision if dec else None, "note": dec.note if dec else None, "actor": dec.actor if dec else None,
                     "updated_at": dec.updated_at.isoformat(timespec="seconds") if dec else None},
        "allowed_actions": workflow.allowed_actions(state, user["role"]) if r.status != "Selaras" else [],
        "history": [{"ts": h.ts, "actor": h.actor, "role": h.role, "action": h.action, "detail": h.detail} for h in hist],
    })
    return out


class DecisionIn(BaseModel):
    decision: str
    note: str = ""


@app.post("/api/claims/{key}/decision")
def decide(key: str, body: DecisionIn, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    r = db.get(ClaimResult, key)
    if not r or (user.get("facilities") is not None and r.facility_id not in user["facilities"]):
        raise HTTPException(404, "Klaim tidak ditemukan atau di luar penugasan Anda.")
    if body.decision not in workflow.ALL_ACTIONS:
        raise HTTPException(400, f"Keputusan tidak dikenal. Pilihan: {', '.join(workflow.ALL_ACTIONS)}")
    if body.decision not in workflow.ROLE_ACTIONS.get(user["role"], set()):
        raise HTTPException(403, f"Peran {user['role']} tidak berwenang melakukan '{body.decision}'.")
    if r.status == "Selaras":
        raise HTTPException(400, "Klaim berstatus Selaras tidak memerlukan keputusan. (Temuan dari Audit Acak dicatat di halaman Audit Acak.)")
    if body.decision in workflow.NOTE_REQUIRED and len(body.note.strip()) < 10:
        raise HTTPException(422, "Catatan wajib diisi (minimal 10 karakter) agar keputusan dapat dipertanggungjawabkan.")
    dec = db.get(Decision, key) or Decision(claim_key=key, state=workflow.INITIAL)
    try:
        new_state = workflow.next_state(dec.state, body.decision)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    dec.state, dec.decision, dec.note, dec.actor, dec.role, dec.updated_at = new_state, body.decision, body.note.strip(), user["username"], user["role"], now()
    db.merge(dec); db.commit()
    log_trail(db, user["username"], user["role"], body.decision.upper().replace(" ", "_"), run_id=r.run_id, claim_key=key, detail=f"{body.note.strip()} → {new_state}")
    return {"ok": True, "state": new_state, "allowed_actions": workflow.allowed_actions(new_state, user["role"])}


# ------------------------------------------------------------------ evaluasi
@app.get("/api/runs/{run_id}/evaluation")
def evaluation(run_id: str, db: Session = Depends(get_db), user: dict = Depends(require("Supervisor", "Admin"))):
    r = _run(db, run_id)
    m = _loads(r.metrics_json)
    if not m:
        return {"run_id": r.id, "available": False, "reason": "Metrik supervised belum tersedia: audit ini tidak membawa label fraud sintetis terpisah. Tidak ada angka yang dipalsukan."}
    return {"run_id": r.id, "available": True, "metrics": m, "data_label": "Dihitung dari label sintetis, bukan data JKN riil"}


@app.get("/api/runs/{run_id}/evaluation/export.csv")
def evaluation_csv(run_id: str, db: Session = Depends(get_db), user: dict = Depends(require("Supervisor", "Admin"))):
    r = _run(db, run_id)
    m = _loads(r.metrics_json)
    if not m:
        raise HTTPException(404, "Tidak ada metrik untuk diekspor.")
    out = io.StringIO(); w = csv.writer(out)
    w.writerow(["# PharmaTrace-AI evaluasi (data sintetis)", f"run={r.id}"])
    w.writerow(["metode", "precision", "recall", "f1", "fpr", "tp", "fp", "fn", "tn", "flagged"])
    for k, label in (("naive", "Naif (klaim > RME)"), ("rule_only", "Rule-only"), ("hybrid", "Hibrida (rule + ML)")):
        x = m[k]; w.writerow([label, f"{x['precision']:.4f}", f"{x['recall']:.4f}", f"{x['f1']:.4f}", f"{x['fpr']:.4f}", x["tp"], x["fp"], x["fn"], x["tn"], x["flagged"]])
    w.writerow([]); w.writerow(["skenario", "varian", "n", "recall_rule", "recall_hibrida"])
    for s in m["by_scenario"]:
        w.writerow([s["scenario"], s["variant"], s["n"], f"{s['recall_rules']:.4f}", f"{s['recall_hybrid']:.4f}"])
    w.writerow([]); w.writerow(["ambang_DI", "precision", "recall", "f1", "fpr", "flagged"])
    for s in m["threshold_sweep"]:
        w.writerow([s["di_threshold"], f"{s['precision']:.4f}", f"{s['recall']:.4f}", f"{s['f1']:.4f}", f"{s['fpr']:.4f}", s["flagged"]])
    w.writerow([]); w.writerow(["kurva_PR_hibrida_precision", "recall"])
    for p_, r_ in zip(m["pr"]["hybrid"]["precision"], m["pr"]["hybrid"]["recall"]):
        w.writerow([f"{p_:.4f}", f"{r_:.4f}"])
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=evaluasi_{r.id}.csv"})


# ------------------------------------------------------------------ audit acak
def _sample_payload(db: Session, run: Run, user: dict) -> dict:
    meta = db.get(RandomMeta, run.id)
    ids = [s.claim_id for s in db.query(RandomSample).filter(RandomSample.run_id == run.id).all()]
    q = _scope(db.query(ClaimResult).filter(ClaimResult.run_id == run.id, ClaimResult.claim_id.in_(ids)), user)
    rows = q.order_by(ClaimResult.amount.desc()).all() if ids else []
    reviews = {x.claim_id: x for x in db.query(RandomReview).filter(RandomReview.run_id == run.id).all()}
    items = []
    for r in rows:
        rv = reviews.get(r.claim_id)
        items.append({"key": r.id, "claim_id": r.claim_id, "facility_id": r.facility_id, "facility_name": r.facility_name, "category": r.category, "generic": r.generic, "unit": r.unit, "qty": _num(r.qty),
                      "rme_expected": _num(r.rme_expected), "available_stock": _num(max(r.slack, 0)), "amount": r.amount, "service_date": r.service_date, "di": r.di,
                      "review": {"verdict": rv.verdict, "note": rv.note, "reviewer": rv.reviewer} if rv else None})
    reviewed = [i for i in items if i["review"]]
    issues = sum(1 for i in reviewed if i["review"]["verdict"] == "Ditemukan masalah")
    lo, hi = _wilson(issues, len(reviewed))
    pool = _scope(db.query(ClaimResult).filter(ClaimResult.run_id == run.id, ClaimResult.status == "Selaras"), user).count()
    stats = {"pool_auto_pass": pool, "sample_size": len(items), "reviewed": len(reviewed), "issues_found": issues,
             "issue_rate": issues / len(reviewed) if reviewed else None, "ci95": [lo, hi] if reviewed else None,
             "expected_missed_in_pool": [round(lo * pool), round(hi * pool)] if reviewed else None}
    return {"run_id": run.id, "pct": meta.pct if meta else None, "seed": meta.seed if meta else None, "draw_no": meta.draw_no if meta else 1, "items": items, "stats": stats}


@app.get("/api/runs/{run_id}/random-audit")
def random_audit(run_id: str, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    return _sample_payload(db, _run(db, run_id), user)


class RedrawIn(BaseModel):
    pct: float = Field(5.0, ge=1, le=50)


@app.post("/api/runs/{run_id}/random-audit/redraw")
def random_redraw(run_id: str, body: RedrawIn, db: Session = Depends(get_db), user: dict = Depends(require("Supervisor"))):
    run = _run(db, run_id)
    meta = db.get(RandomMeta, run.id) or RandomMeta(run_id=run.id, draw_no=0)
    draw_no = (meta.draw_no or 0) + 1
    seed = int(_loads(run.params_json, {}).get("seed", get_settings().random_seed)) + draw_no * 7919
    ids = [r.claim_id for r in db.query(ClaimResult.claim_id).filter(ClaimResult.run_id == run.id, ClaimResult.status == "Selaras").all()]
    chosen = draw_sample(ids, body.pct, seed)
    db.query(RandomSample).filter(RandomSample.run_id == run.id).delete(); db.query(RandomReview).filter(RandomReview.run_id == run.id).delete()
    db.bulk_insert_mappings(RandomSample, [{"run_id": run.id, "claim_id": c, "draw_no": draw_no} for c in chosen])
    meta.draw_no, meta.pct, meta.seed = draw_no, body.pct, seed
    db.merge(meta); db.commit()
    log_trail(db, user["username"], user["role"], "AUDIT_ACAK_AMBIL_ULANG", run_id=run.id, detail=f"pct={body.pct}; seed={seed}; n={len(chosen)}")
    return _sample_payload(db, run, user)


class ReviewIn(BaseModel):
    claim_id: str
    verdict: str
    note: str = ""


@app.post("/api/runs/{run_id}/random-audit/review")
def random_review(run_id: str, body: ReviewIn, db: Session = Depends(get_db), user: dict = Depends(require("Verifikator", "Supervisor"))):
    run = _run(db, run_id)
    if body.verdict not in ("Sesuai", "Ditemukan masalah"):
        raise HTTPException(400, "verdict harus 'Sesuai' atau 'Ditemukan masalah'.")
    if not db.get(RandomSample, {"run_id": run.id, "claim_id": body.claim_id}):
        raise HTTPException(404, "Klaim tidak termasuk sampel audit acak aktif.")
    claim = db.query(ClaimResult).filter(ClaimResult.run_id == run.id, ClaimResult.claim_id == body.claim_id).first()
    if not claim or (user.get("facilities") is not None and claim.facility_id not in user["facilities"]):
        raise HTTPException(404, "Klaim tidak ditemukan atau di luar penugasan Anda.")
    if body.verdict == "Ditemukan masalah" and len(body.note.strip()) < 10:
        raise HTTPException(422, "Catatan temuan wajib diisi (minimal 10 karakter).")
    db.merge(RandomReview(run_id=run.id, claim_id=body.claim_id, verdict=body.verdict, note=body.note.strip(), reviewer=user["username"], ts=now().isoformat(timespec="seconds")))
    db.commit()
    log_trail(db, user["username"], user["role"], "AUDIT_ACAK_TINJAU", run_id=run.id, claim_key=f"{run.id}:{body.claim_id}", detail=f"{body.verdict}: {body.note.strip()}")
    return _sample_payload(db, run, user)


# ------------------------------------------------------------------ kalkulator dampak
class ImpactIn(BaseModel):
    claims_drugs_alkes: float = Field(31_700_000_000_000, gt=0)
    leakage_pct: float = Field(1.0, ge=0, le=100)
    prevention_pct: float = Field(30.0, ge=0, le=100)
    recall_source: str = "hybrid"


@app.post("/api/impact")
def impact(body: ImpactIn, db: Session = Depends(get_db), user: dict = Depends(require("Supervisor", "Admin"))):
    run = db.query(Run).filter(Run.has_labels.is_(True)).order_by(Run.created_at.desc()).first()
    if not run:
        raise HTTPException(409, "Recall nyata belum tersedia. Jalankan audit data sintetis berlabel di Upload & Audit terlebih dahulu.")
    m = _loads(run.metrics_json)
    rec = m["rule_only" if body.recall_source == "rule_only" else "hybrid"]["recall"]
    hemat = body.claims_drugs_alkes * body.leakage_pct / 100 * rec * body.prevention_pct / 100
    return {"estimate_rupiah": hemat, "recall_actual": rec, "recall_run_id": run.id, "recall_source": body.recall_source,
            "formula": "Hemat = klaim obat & alkes × % kebocoran × recall × % pencegahan", "label": "Estimasi, bukan hasil terukur",
            "caveat": "Recall diukur pada data SINTETIS; recall pada data JKN riil belum diketahui dan harus diuji pada pilot."}


# ------------------------------------------------------------------ privasi & tata kelola
class PrivacyDemoIn(BaseModel):
    value: str = Field("3201010101010001", max_length=64)


@app.post("/api/privacy/demo")
def privacy_demo(body: PrivacyDemoIn, user: dict = Depends(current_user)):
    return {**demo_before_after(body.value, get_settings().hmac_secret), "key_source": "environment variable HMAC_SECRET"}


@app.get("/api/privacy/overview")
def privacy_overview(db: Session = Depends(get_db), user: dict = Depends(current_user)):
    s = get_settings()
    run = db.query(Run).order_by(Run.created_at.desc()).first()
    return {"algorithm": "HMAC-SHA-256", "key_fingerprint": key_fingerprint(s.hmac_secret), "key_is_default_demo": s.secret_is_default,
            "role_matrix": ROLE_MATRIX, "legal_basis": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (prinsip minimisasi & pseudonimisasi)",
            "data_minimization": ["kode obat (KFA)", "dosis & jumlah", "tanggal layanan", "ID faskes", "ID pasien & dokter terpseudonim (80 bit)"],
            "retention": {"raw_rme": "Tidak disimpan permanen: diproses di memori lalu dibuang setelah pseudonimisasi", "audit_results": "Disimpan di SQLite dalam bentuk pseudonim",
                          "labels": "Label sintetis di tabel terpisah, hanya dibaca modul evaluasi"},
            "last_run_privacy": _loads(run.privacy_json) if run and user.get("facilities") is None else None}


@app.get("/api/audit-trail")
def audit_trail(limit: int = Query(100, le=500), claim_key: str | None = None, db: Session = Depends(get_db), user: dict = Depends(require("Supervisor", "Admin"))):
    q = db.query(Trail)
    if claim_key:
        q = q.filter(Trail.claim_key == claim_key)
    rows = q.order_by(Trail.id.desc()).limit(limit).all()
    return {"items": [{"id": t.id, "ts": t.ts, "actor": t.actor, "role": t.role, "action": t.action, "run_id": t.run_id, "claim_key": t.claim_key, "detail": t.detail, "hash": t.hash[:12]} for t in rows],
            "total": db.query(func.count(Trail.id)).scalar()}


@app.get("/api/audit-trail/verify")
def audit_trail_verify(db: Session = Depends(get_db), user: dict = Depends(require("Supervisor", "Admin"))):
    return verify_chain(db)
