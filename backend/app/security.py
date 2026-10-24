"""Autentikasi demo bertoken HMAC, RBAC (Verifikator / Supervisor / Admin) dan audit trail berantai-hash."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import threading
import time

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Trail, get_db, now

USERS = {
    "verifikator1": {"password": "verifikator123", "role": "Verifikator", "name": "Verifikator Demo", "facilities": ["RS-B", "RS-D", "RS-G", "RS-L"]},
    "supervisor1": {"password": "supervisor123", "role": "Supervisor", "name": "Supervisor Demo", "facilities": None},
    "admin1": {"password": "admin123", "role": "Admin", "name": "Admin Demo", "facilities": None},
}
ROLE_MATRIX = [
    {"capability": "Melihat klaim ter-flag", "Verifikator": "Hanya faskes yang ditugaskan", "Supervisor": "Semua faskes", "Admin": "Semua faskes"},
    {"capability": "Keputusan klaim (Tolak / Klarifikasi / Pengecualian Medis)", "Verifikator": "Ya", "Supervisor": "Ya", "Admin": "Tidak"},
    {"capability": "Mencatat sanggahan RS", "Verifikator": "Ya", "Supervisor": "Ya", "Admin": "Tidak"},
    {"capability": "Memutus sanggahan (diterima / ditolak final)", "Verifikator": "Tidak", "Supervisor": "Ya", "Admin": "Tidak"},
    {"capability": "Menjalankan audit & memuat data", "Verifikator": "Tidak", "Supervisor": "Ya", "Admin": "Ya"},
    {"capability": "Audit acak 5% (tinjau / ambil ulang sampel)", "Verifikator": "Tinjau", "Supervisor": "Tinjau + ambil ulang", "Admin": "Lihat"},
    {"capability": "Melihat & memverifikasi audit trail", "Verifikator": "Tidak", "Supervisor": "Ya", "Admin": "Ya"},
]
_lock = threading.Lock()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _sign(payload: str) -> str:
    return _b64(hmac.new(get_settings().token_secret.encode(), payload.encode(), hashlib.sha256).digest())


def make_token(username: str) -> str:
    payload = _b64(json.dumps({"u": username, "exp": int(time.time()) + 8 * 3600}).encode())
    return f"{payload}.{_sign(payload)}"


def verify_token(token: str) -> dict | None:
    try:
        payload, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, _sign(payload)):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data["exp"] < time.time() or data["u"] not in USERS:
            return None
        return {"username": data["u"], **{k: v for k, v in USERS[data["u"]].items() if k != "password"}}
    except Exception:  # noqa: BLE001
        return None


def login(username: str, password: str) -> dict | None:
    u = USERS.get(username)
    if not u or not hmac.compare_digest(u["password"], password):
        return None
    return {"token": make_token(username), "user": {"username": username, "role": u["role"], "name": u["name"], "facilities": u["facilities"]}}


def current_user(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    user = verify_token(token) if token else None
    if not user:
        raise HTTPException(401, "Sesi tidak valid atau kedaluwarsa. Silakan masuk kembali.")
    return user


def require(*roles: str):
    def dep(user: dict = Depends(current_user)) -> dict:
        if roles and user["role"] not in roles:
            raise HTTPException(403, f"Peran {user['role']} tidak memiliki izin untuk aksi ini (butuh: {', '.join(roles)}).")
        return user
    return dep


def _hash(prev: str, ts: str, actor: str, role: str, action: str, run_id: str, claim_key: str, detail: str) -> str:
    return hashlib.sha256("|".join([prev, ts, actor, role, action, run_id or "", claim_key or "", detail or ""]).encode()).hexdigest()


def log_trail(db: Session, actor: str, role: str, action: str, run_id: str | None = None, claim_key: str | None = None, detail: str = "") -> None:
    with _lock:
        last = db.query(Trail).order_by(Trail.id.desc()).first()
        prev = last.hash if last else "GENESIS"
        ts = now().isoformat(timespec="seconds")
        db.add(Trail(ts=ts, actor=actor, role=role, action=action, run_id=run_id, claim_key=claim_key, detail=detail, prev_hash=prev,
                     hash=_hash(prev, ts, actor, role, action, run_id or "", claim_key or "", detail)))
        db.commit()


def verify_chain(db: Session) -> dict:
    prev, count = "GENESIS", 0
    for t in db.query(Trail).order_by(Trail.id.asc()).yield_per(500):
        count += 1
        if t.prev_hash != prev or t.hash != _hash(prev, t.ts, t.actor, t.role, t.action, t.run_id or "", t.claim_key or "", t.detail or ""):
            return {"valid": False, "entries": count, "broken_at_id": t.id}
        prev = t.hash
    return {"valid": True, "entries": count, "broken_at_id": None}
