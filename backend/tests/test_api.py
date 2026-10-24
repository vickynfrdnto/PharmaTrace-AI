import time
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import jobs
from app.db import Run, SessionLocal

client = TestClient(app)


def _login(user="supervisor1", pw="supervisor123"):
    r = client.post("/api/auth/login", json={"username": user, "password": pw})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _wait(job_id, h, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/api/audit/jobs/{job_id}", headers=h).json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.4)
    raise AssertionError("job timeout")


@pytest.fixture(scope="module")
def run_id():
    h = _login()
    r = client.post("/api/audit/run", json={"records": 2000, "seed": 5}, headers=h)
    assert r.status_code == 202
    j = _wait(r.json()["job_id"], h)
    assert j["status"] == "done", j
    assert all(s["status"] == "done" and s["seconds"] is not None for s in j["stages"])
    return j["run_id"]


def test_auth_required_and_rbac():
    assert client.get("/api/runs").status_code == 401
    v = _login("verifikator1", "verifikator123")
    assert client.post("/api/audit/run", json={"records": 500}, headers=v).status_code == 403
    assert client.post("/api/auth/login", json={"username": "x", "password": "y"}).status_code == 401
    token = client.post("/api/auth/login", json={"username": "supervisor1", "password": "supervisor123"}).json()["token"]
    assert client.get(f"/api/runs/latest?token={token}").status_code == 401


def test_job_status_is_owner_scoped():
    job = jobs.new_job("supervisor1", "Supervisor")
    admin = _login("admin1", "admin123")
    assert client.get(f"/api/audit/jobs/{job['id']}", headers=admin).status_code == 404
    assert client.get(f"/api/audit/jobs/{job['id']}", headers=_login()).status_code == 200


def test_legacy_raw_identifier_is_removed_from_saved_privacy(run_id):
    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        run.privacy_json = json.dumps({"example": {"before": "SENSITIVE-RAW-ID", "after": "pseudonym"}})
        db.commit()
    finally:
        db.close()
    assert jobs.scrub_legacy_privacy_examples() == 1
    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        assert "SENSITIVE-RAW-ID" not in run.privacy_json
        assert "example" not in run.privacy_json
    finally:
        db.close()


def test_e2e_upload_audit_decision(run_id):
    h, v = _login(), _login("verifikator1", "verifikator123")
    s = client.get(f"/api/runs/{run_id}", headers=h).json()
    assert s["data_label"] == "Data Sintetis" and s["summary"]["flagged"] > 0 and s["summary"]["process_seconds"] > 0
    items = client.get(f"/api/runs/{run_id}/claims?flagged_only=true&facility=RS-D&limit=100", headers=v).json()["items"]
    target = next(i for i in items if i["claim_id"] == "CLM-DEMO-01")
    d = client.get(f"/api/claims/{target['key']}", headers=v).json()
    assert d["three_doors"]["klaim"]["qty"] == 5 and d["three_doors"]["rme"]["expected"] == 1 and d["three_doors"]["ekatalog"]["available_stock"] == 0
    assert "answer_key" not in d
    assert "Tolak Klaim" in d["allowed_actions"]
    # catatan wajib
    assert client.post(f"/api/claims/{target['key']}/decision", json={"decision": "Tolak Klaim", "note": "x"}, headers=v).status_code == 422
    ok = client.post(f"/api/claims/{target['key']}/decision", json={"decision": "Tolak Klaim", "note": "Tidak ada jejak pembelian albumin"}, headers=v)
    assert ok.status_code == 200 and ok.json()["state"].startswith("Ditolak")
    # RS menyanggah -> hanya Supervisor yang memutus
    assert client.post(f"/api/claims/{target['key']}/decision", json={"decision": "RS Menyanggah", "note": "Faktur ada, terlambat input"}, headers=v).status_code == 200
    assert client.post(f"/api/claims/{target['key']}/decision", json={"decision": "Sanggahan Diterima", "note": "Faktur terverifikasi"}, headers=v).status_code == 403
    fin = client.post(f"/api/claims/{target['key']}/decision", json={"decision": "Sanggahan Diterima", "note": "Faktur terverifikasi manual"}, headers=h)
    assert fin.status_code == 200 and "Dikecualikan" in fin.json()["state"]
    assert client.post(f"/api/claims/{target['key']}/decision", json={"decision": "Tolak Klaim", "note": "ulang tolak klaim ini"}, headers=h).status_code == 409
    hist = client.get(f"/api/claims/{target['key']}", headers=h).json()["history"]
    assert [x["action"] for x in hist if x["action"] != "BUKA_KLAIM"] == ["TOLAK_KLAIM", "RS_MENYANGGAH", "SANGGAHAN_DITERIMA"]
    assert client.get("/api/audit-trail/verify", headers=h).json()["valid"] is True


def test_verifikator_scope(run_id):
    v = _login("verifikator1", "verifikator123")
    response = client.get(f"/api/runs/{run_id}/claims?limit=500", headers=v).json()
    fac = {i["facility_id"] for i in response["items"]}
    assert fac <= {"RS-B", "RS-D", "RS-G", "RS-L"}
    summary = client.get(f"/api/runs/{run_id}", headers=v).json()
    assert summary["summary"]["records"] == response["total"]
    assert summary["meta"] == {} and summary["privacy"] is None
    assert client.get(f"/api/runs/{run_id}/evaluation", headers=v).status_code == 403
    assert client.get(f"/api/runs/{run_id}/validation", headers=v).status_code == 403


def test_unflagged_claim_cannot_be_decided(run_id):
    h = _login()
    ok = client.get(f"/api/runs/{run_id}/claims?status=Selaras&limit=1", headers=h).json()["items"][0]
    assert client.post(f"/api/claims/{ok['key']}/decision", json={"decision": "Minta Klarifikasi RS"}, headers=h).status_code == 400


def test_evaluation_heatmap_validation_random_audit(run_id):
    h = _login()
    ev = client.get(f"/api/runs/{run_id}/evaluation", headers=h).json()
    assert ev["available"] and 0 <= ev["metrics"]["hybrid"]["recall"] <= 1
    assert client.get(f"/api/runs/{run_id}/evaluation/export.csv", headers=h).status_code == 200
    hm = client.get(f"/api/runs/{run_id}/heatmap", headers=h).json()
    assert hm["cells"] and {"diff_pct", "facility_name", "category"} <= set(hm["cells"][0])
    assert client.get(f"/api/runs/{run_id}/validation", headers=h).json()["validation"]["chi_square"]
    ra = client.get(f"/api/runs/{run_id}/random-audit", headers=h).json()
    assert ra["items"] and all(i["review"] is None for i in ra["items"])
    assert all("answer_key" not in i for i in ra["items"])
    cid = ra["items"][0]["claim_id"]
    rv = client.post(f"/api/runs/{run_id}/random-audit/review", json={"claim_id": cid, "verdict": "Sesuai"}, headers=h)
    assert rv.status_code == 200 and rv.json()["stats"]["reviewed"] == 1


def test_verifikator_random_audit_is_scoped_and_blind(run_id):
    v = _login("verifikator1", "verifikator123")
    ra = client.get(f"/api/runs/{run_id}/random-audit", headers=v)
    assert ra.status_code == 200
    assert all(i["facility_id"] in {"RS-B", "RS-D", "RS-G", "RS-L"} for i in ra.json()["items"])
    assert all("answer_key" not in i for i in ra.json()["items"])
    assert "answer_key_fraud_in_sample" not in ra.json()["stats"]

    h = _login()
    all_samples = client.get(f"/api/runs/{run_id}/random-audit", headers=h).json()["items"]
    outside = next((i for i in all_samples if i["facility_id"] not in {"RS-B", "RS-D", "RS-G", "RS-L"}), None)
    if outside:
        response = client.post(f"/api/runs/{run_id}/random-audit/review", json={"claim_id": outside["claim_id"], "verdict": "Sesuai"}, headers=v)
        assert response.status_code == 404


def test_impact_uses_actual_recall(run_id):
    h = _login()
    ev = client.get(f"/api/runs/{run_id}/evaluation", headers=h).json()["metrics"]["hybrid"]["recall"]
    r = client.post("/api/impact", json={"claims_drugs_alkes": 1e12, "leakage_pct": 2, "prevention_pct": 50}, headers=h).json()
    assert r["recall_actual"] == pytest.approx(ev) and r["estimate_rupiah"] == pytest.approx(1e12 * 0.02 * ev * 0.5)
    assert r["label"] == "Estimasi, bukan hasil terukur"


def test_upload_bad_file_gives_clear_error():
    h = _login()
    files = {"procurement_file": ("p.csv", b"a,b\n1,2\n"), "rme_file": ("r.json", b"{}"), "claims_file": ("c.csv", b"")}
    r = client.post("/api/audit/upload", files=files, headers=h)
    j = _wait(r.json()["job_id"], h)
    assert j["status"] == "error" and j["error"]


def test_privacy_demo():
    h = _login()
    d = client.post("/api/privacy/demo", json={"value": "3201010101010001"}, headers=h).json()
    assert d["before"] != d["after"] and len(d["after"]) == 20
