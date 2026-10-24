"""Pseudonimisasi HMAC-SHA-256 (UU PDP: privacy by design). Kunci dari environment variable."""
from __future__ import annotations

import hashlib
import hmac

import pandas as pd

PSEUDO_LEN = 20  # karakter hex yang disimpan (80 bit)


def pseudonymize(value: object, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), str(value).strip().encode("utf-8"), hashlib.sha256).hexdigest()
    return digest[:PSEUDO_LEN]


def pseudonymize_series(series: pd.Series, secret: str) -> pd.Series:
    """Vektorisasi lewat tabel unik supaya cepat untuk puluhan ribu baris."""
    uniques = pd.unique(series.astype(str))
    mapping = {v: pseudonymize(v, secret) for v in uniques}
    return series.astype(str).map(mapping)


def key_fingerprint(secret: str) -> str:
    """Sidik jari kunci (bukan kuncinya) agar tata kelola kunci dapat ditunjukkan di demo."""
    return hashlib.sha256(("fp|" + secret).encode("utf-8")).hexdigest()[:10]


def demo_before_after(value: str, secret: str) -> dict:
    return {
        "before": value,
        "after": pseudonymize(value, secret),
        "algorithm": "HMAC-SHA-256 (dipotong 80 bit)",
        "reversible": False,
    }
