"""Skema SQLite (SQLAlchemy). Hanya hasil audit PSEUDONIM yang disimpan; RME mentah tidak pernah ditulis ke DB."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, Index, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import get_settings

settings = get_settings()
engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
Base = declarative_base()


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Run(Base):
    __tablename__ = "runs"
    id = Column(String, primary_key=True)
    created_at = Column(DateTime, default=now, index=True)
    created_by = Column(String)
    source = Column(String)            # sintetis | upload
    params_json = Column(Text)
    summary_json = Column(Text)
    metrics_json = Column(Text)
    heatmap_json = Column(Text)
    validation_json = Column(Text)
    privacy_json = Column(Text)
    meta_json = Column(Text)
    has_labels = Column(Boolean, default=False)


class ClaimResult(Base):
    __tablename__ = "claim_results"
    id = Column(String, primary_key=True)            # run_id:claim_id
    run_id = Column(String, index=True)
    claim_id = Column(String, index=True)
    facility_id = Column(String); facility_name = Column(String); peer_class = Column(String)
    category = Column(String); kfa = Column(String); generic = Column(String); unit = Column(String); channel = Column(String)
    service_date = Column(String)
    qty = Column(Float); rme_expected = Column(Float); rme_found = Column(Boolean); slack = Column(Float); proc_cell_total = Column(Float)
    unit_price = Column(Float); amount = Column(Float); potential_difference = Column(Float); held_value = Column(Float)
    di = Column(Float); rule_part = Column(Float); ml_part = Column(Float); fin_part = Column(Float); rule_score = Column(Float); ml_score = Column(Float)
    flagged = Column(Boolean); waiting = Column(Boolean); status = Column(String); priority = Column(String); primary_rule = Column(String)
    rule_flags = Column(Text); reason = Column(Text); recommendation = Column(Text); shap_json = Column(Text)
    pid = Column(String); did = Column(String)
    __table_args__ = (Index("ix_cr_run_fac_cat", "run_id", "facility_id", "category"), Index("ix_cr_run_status", "run_id", "status"))


class EvalLabel(Base):
    """Label sintetis disimpan di tabel TERPISAH; hanya dibaca oleh modul evaluasi."""
    __tablename__ = "eval_labels"
    run_id = Column(String, primary_key=True)
    claim_id = Column(String, primary_key=True)
    label_fraud = Column(Integer); scenario = Column(String); variant = Column(String)


class Decision(Base):
    __tablename__ = "decisions"
    claim_key = Column(String, primary_key=True)
    state = Column(String, default="Belum ditinjau")
    decision = Column(String); note = Column(Text); actor = Column(String); role = Column(String)
    updated_at = Column(DateTime, default=now)


class Trail(Base):
    __tablename__ = "audit_trail"
    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(String); actor = Column(String); role = Column(String); action = Column(String)
    run_id = Column(String, index=True); claim_key = Column(String, index=True); detail = Column(Text)
    prev_hash = Column(String); hash = Column(String)


class RandomSample(Base):
    __tablename__ = "random_samples"
    run_id = Column(String, primary_key=True)
    claim_id = Column(String, primary_key=True)
    draw_no = Column(Integer, default=1)


class RandomMeta(Base):
    __tablename__ = "random_meta"
    run_id = Column(String, primary_key=True)
    draw_no = Column(Integer, default=1); pct = Column(Float); seed = Column(Integer)


class RandomReview(Base):
    __tablename__ = "random_reviews"
    run_id = Column(String, primary_key=True)
    claim_id = Column(String, primary_key=True)
    verdict = Column(String); note = Column(Text); reviewer = Column(String); ts = Column(String)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
