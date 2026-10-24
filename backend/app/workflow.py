"""Mesin status keputusan human-in-the-loop. AI hanya merekomendasikan; transisi hanya terjadi lewat aksi manusia."""
from __future__ import annotations

INITIAL = "Belum ditinjau"
TRANSITIONS: dict[str, dict[str, str]] = {
    "Belum ditinjau": {"Tolak Klaim": "Ditolak — masa sanggah", "Minta Klarifikasi RS": "Menunggu klarifikasi RS", "Pengecualian Medis": "Dikecualikan (pengecualian medis)"},
    "Menunggu klarifikasi RS": {"Tolak Klaim": "Ditolak — masa sanggah", "Pengecualian Medis": "Dikecualikan (pengecualian medis)",
                                "Minta Klarifikasi RS": "Menunggu klarifikasi RS", "RS Menyanggah": "Sanggahan RS masuk"},
    "Ditolak — masa sanggah": {"RS Menyanggah": "Sanggahan RS masuk"},
    "Sanggahan RS masuk": {"Sanggahan Diterima": "Dikecualikan (sanggahan diterima)", "Sanggahan Ditolak": "Ditolak final"},
}
ROLE_ACTIONS = {
    "Verifikator": {"Tolak Klaim", "Minta Klarifikasi RS", "Pengecualian Medis", "RS Menyanggah"},
    "Supervisor": {"Tolak Klaim", "Minta Klarifikasi RS", "Pengecualian Medis", "RS Menyanggah", "Sanggahan Diterima", "Sanggahan Ditolak"},
    "Admin": set(),
}
NOTE_REQUIRED = {"Tolak Klaim", "Pengecualian Medis", "RS Menyanggah", "Sanggahan Diterima", "Sanggahan Ditolak"}
ALL_ACTIONS = sorted({a for t in TRANSITIONS.values() for a in t})


def next_state(state: str, action: str) -> str:
    try:
        return TRANSITIONS[state][action]
    except KeyError:
        raise ValueError(f"Aksi '{action}' tidak dapat dilakukan dari status '{state}'.") from None


def allowed_actions(state: str, role: str) -> list[str]:
    return [a for a in TRANSITIONS.get(state, {}) if a in ROLE_ACTIONS.get(role, set())]
