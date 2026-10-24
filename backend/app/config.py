"""Konfigurasi aplikasi. Semua nilai dapat diubah lewat environment variable / file .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SECRET = "demo-secret-GANTI-sebelum-pilot"


def _load_dotenv() -> None:
    """Pembaca .env minimal (tanpa dependency). Tidak menimpa env yang sudah di-set."""
    for candidate in (ROOT / ".env", ROOT.parent / ".env"):
        if candidate.exists():
            for line in candidate.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
            break


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    hmac_secret: str
    token_secret: str
    database_url: str
    heatmap_threshold_pct: float
    grace_period_days: int
    audit_sample_pct: float
    di_threshold: float
    repeat_refill_min_days: int
    package_window_days: int
    default_records: int
    max_records: int
    random_seed: int

    @property
    def secret_is_default(self) -> bool:
        return self.hmac_secret == DEFAULT_SECRET


def get_settings() -> Settings:
    data_dir = ROOT / "data"
    data_dir.mkdir(exist_ok=True)
    secret = os.getenv("HMAC_SECRET", DEFAULT_SECRET)
    return Settings(
        hmac_secret=secret,
        token_secret=os.getenv("TOKEN_SECRET", secret + "|token"),
        database_url=os.getenv("DATABASE_URL", f"sqlite:///{(data_dir / 'pharmatrace.db').as_posix()}"),
        heatmap_threshold_pct=float(os.getenv("HEATMAP_THRESHOLD_PCT", "20")),
        grace_period_days=int(os.getenv("GRACE_PERIOD_DAYS", "14")),
        audit_sample_pct=float(os.getenv("AUDIT_SAMPLE_PCT", "5")),
        di_threshold=float(os.getenv("DI_THRESHOLD", "20")),
        repeat_refill_min_days=int(os.getenv("REPEAT_REFILL_MIN_DAYS", "20")),
        package_window_days=int(os.getenv("PACKAGE_WINDOW_DAYS", "30")),
        default_records=int(os.getenv("DEFAULT_RECORDS", "10000")),
        max_records=int(os.getenv("MAX_RECORDS", "30000")),
        random_seed=int(os.getenv("RANDOM_SEED", "20261011")),
    )
