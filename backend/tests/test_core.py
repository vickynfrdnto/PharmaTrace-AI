import json

import numpy as np
import pandas as pd
import pytest

from app.engine import EngineConfig, run_engine
from app.generator import generate_bundle
from app.ingest import IngestError, ingest, read_csv_bytes
from app.master import DRUG_BY_KFA, expected_units, normalize_name
from app.privacy import pseudonymize

SECRET = "test-secret-123"


@pytest.fixture(scope="module")
def bundle():
    return generate_bundle(3000, 7)


@pytest.fixture(scope="module")
def result(bundle):
    ing = ingest(bundle.procurement, bundle.claims, bundle.rme, SECRET)
    return run_engine(ing, EngineConfig(seed=7), bundle.labels, target_records=3000)


# ---------------------------------------------------------------- generator
def test_generator_reproducible_and_counts():
    a, b = generate_bundle(1000, 11), generate_bundle(1000, 11)
    assert a.claims.equals(b.claims) and a.procurement.equals(b.procurement)
    assert a.meta["actual"]["claims"] == 1000 and a.meta["actual"]["rme_medication_administration"] == 1000
    assert generate_bundle(1000, 12).claims.equals(a.claims) is False


def test_fraud_rate_and_labels_separate(bundle):
    rate = bundle.labels.label_fraud.mean()
    assert 0.13 <= rate <= 0.17
    assert not ({"label_fraud", "scenario", "variant"} & set(bundle.claims.columns))
    assert set(bundle.labels.scenario) >= {"clean", "phantom", "inflate", "duplicate", "no_visit"}


def test_showcase_case_matches_proposal(bundle):
    row = bundle.claims[bundle.claims.claim_id == "CLM-DEMO-01"].iloc[0]
    assert row.qty == 5 and row.facility_id == "RS-D"


def test_traps_exist(bundle):
    t = bundle.meta["traps"]
    for k in ("wastage_wajar", "faktur_terlambat_dalam_tenggang", "pembelian_non_ekatalog_sah", "brand_variants"):
        assert t[k] > 0


# ---------------------------------------------------------------- normalisasi
def test_name_normalization():
    assert normalize_name("Albutein")[0] == "KFA-ALB-001"
    assert normalize_name("ALBUTEIN")[0] == "KFA-ALB-001"
    code, method = normalize_name("Albuteni")  # salah ketik
    assert code == "KFA-ALB-001" and method == "fuzzy"
    assert normalize_name("obat-tidak-dikenal-xyz")[0] is None


def test_wastage_rounding_is_allowed():
    assert expected_units(DRUG_BY_KFA["KFA-ONC-001"], 130) == 2   # 130 mg -> 2 vial 100 mg (susut wajar)


# ---------------------------------------------------------------- privasi
def test_pseudonymization_deterministic_and_keyed():
    a = pseudonymize("3201010101010001", SECRET)
    assert a == pseudonymize("3201010101010001", SECRET) and len(a) == 20
    assert a != pseudonymize("3201010101010001", "kunci-lain") and a != pseudonymize("3201010101010002", SECRET)


def test_no_raw_identifiers_after_ingest(bundle):
    ing = ingest(bundle.procurement, bundle.claims, bundle.rme, SECRET)
    assert "example" not in ing.privacy
    assert "9900000000000000" not in str(ing.privacy)
    for df in (ing.claims, ing.enc, ing.med):
        assert not any(c in df.columns for c in ("nik", "doctor_id", "doc"))
        assert not df.astype(str).apply(lambda col: col.str.contains(r"\b99\d{14}\b")).any().any()


def test_label_columns_rejected_in_input(bundle):
    bad = bundle.claims.assign(label_fraud=0)
    with pytest.raises(IngestError):
        ingest(bundle.procurement, bad, bundle.rme, SECRET)


def test_csv_identifiers_keep_leading_zeroes_and_amount_must_match(bundle):
    parsed = read_csv_bytes(b"claim_id,nik\n0007,001234\n", "test")
    assert parsed.iloc[0]["claim_id"] == "0007" and parsed.iloc[0]["nik"] == "001234"
    bad = bundle.claims.assign(amount=bundle.claims["amount"] + 1_000)
    with pytest.raises(IngestError, match="amount"):
        ingest(bundle.procurement, bad, bundle.rme, SECRET)


# ---------------------------------------------------------------- engine
def test_phantom_showcase_flagged_with_reason(result):
    r = result.claims.set_index("claim_id").loc["CLM-DEMO-01"]
    assert r.flagged and r.rule_stock and r.slack_grace <= 0
    assert "klaim 5 vial" in r.reason and "RME 1 vial" in r.reason


def test_stock_balance_flags_unbacked_claims():
    rows_p = [dict(procurement_id="P1", facility_id="RS-A", drug_name="Albutein", qty=3, unit_price=1, purchase_date="2026-08-01", invoice_input_date="2026-08-01", channel="e-Katalog", invoice_no="I1")]
    ing = _mini(rows_p, qty=5)
    res = run_engine(ing, EngineConfig(), None)
    c = res.claims.iloc[0]
    assert c.rule_stock and c.gap_grace == 2


def test_grace_period_waits_not_rejects():
    p = [dict(procurement_id="P1", facility_id="RS-A", drug_name="Albutein", qty=5, unit_price=1, purchase_date="2026-08-01", invoice_input_date="2026-08-10", channel="e-Katalog", invoice_no="I1")]
    res = run_engine(_mini(p, qty=1, date="2026-08-03"), EngineConfig(grace_days=14), None)
    c = res.claims.iloc[0]
    assert c.status == "Menunggu verifikasi faktur" and not c.flagged and c.waiting_days == 7


def test_late_invoice_beyond_grace_is_flagged():
    p = [dict(procurement_id="P1", facility_id="RS-A", drug_name="Albutein", qty=5, unit_price=1, purchase_date="2026-08-01", invoice_input_date="2026-08-25", channel="e-Katalog", invoice_no="I1")]
    res = run_engine(_mini(p, qty=1, date="2026-08-03"), EngineConfig(grace_days=14), None)
    assert res.claims.iloc[0].rule_stock


def test_off_catalog_purchase_counts_as_stock():
    p = [dict(procurement_id="P1", facility_id="RS-A", drug_name="Albutein", qty=5, unit_price=1, purchase_date="2026-08-01", invoice_input_date="2026-08-01", channel="Non e-Katalog", invoice_no="I1")]
    assert not run_engine(_mini(p, qty=1), EngineConfig(), None).claims.iloc[0].flagged


def test_metrics_computed_and_not_hardcoded(result):
    m = result.metrics
    assert m["hybrid"]["recall"] >= m["rule_only"]["recall"] - 1e-9
    assert m["rule_only"]["precision"] > m["naive"]["precision"]
    tp, fp, fn, tn = (m["hybrid"][k] for k in ("tp", "fp", "fn", "tn"))
    assert tp + fp + fn + tn == m["n_evaluated"]
    assert m["hybrid"]["precision"] == pytest.approx(tp / (tp + fp))


def test_engine_never_sets_decisions(result):
    assert "decision" not in result.claims.columns and result.claims.status.isin(["Perlu review verifikator", "Menunggu verifikasi faktur", "Selaras"]).all()


def test_discrepancy_index_bounds_and_shap(result):
    c = result.claims
    assert c.di.between(0, 100).all()
    top = c[c.flagged].sort_values("di", ascending=False).iloc[0]
    assert top["shap"] and len(top["shap"]) <= 6


# ---------------------------------------------------------------- error handling
def test_errors_are_clear(bundle):
    with pytest.raises(IngestError, match="Kolom wajib"):
        ingest(bundle.procurement.drop(columns=["qty"]), bundle.claims, bundle.rme, SECRET)
    with pytest.raises(IngestError, match="kosong"):
        ingest(bundle.procurement.iloc[0:0], bundle.claims, bundle.rme, SECRET)
    with pytest.raises(IngestError, match="tanggal"):
        ingest(bundle.procurement.assign(purchase_date="bukan-tanggal"), bundle.claims, bundle.rme, SECRET)


def _mini(proc_rows, qty, date="2026-08-05"):
    claims = pd.DataFrame([dict(claim_id="C1", sep_no="S1", rme_encounter_ref="E1", facility_id="RS-A", nik="9900000000000001", doctor_id="D1", claim_channel="Non-Paket",
                                package_code="", drug_name="Albutein", claim_date=date, qty=qty, unit_price=1, amount=qty)])
    rme = {"entry": [
        {"resource": {"resourceType": "Encounter", "id": "E1", "subject": {"identifier": {"value": "9900000000000001"}}, "serviceProvider": {"identifier": {"value": "RS-A"}},
                      "participant": [{"individual": {"identifier": {"value": "D1"}}}], "period": {"start": date, "end": date}, "class": {"code": "AMB"}}},
        {"resource": {"resourceType": "MedicationAdministration", "id": "M1", "context": {"reference": "Encounter/E1"}, "subject": {"identifier": {"value": "9900000000000001"}},
                      "performer": [{"actor": {"identifier": {"value": "D1"}}}], "location": {"identifier": {"value": "RS-A"}}, "medicationCodeableConcept": {"text": "Albutein"},
                      "effectiveDateTime": date, "dosage": {"dose": {"value": 100 * qty, "unit": "mL"}}}}]}
    return ingest(pd.DataFrame(proc_rows), claims, rme, SECRET)
