"""Engine rekonsiliasi PharmaTrace-AI: normalisasi -> aturan deterministik -> IsolationForest -> SHAP -> Discrepancy Index.

BOBOT DISCREPANCY INDEX (terdokumentasi, 0-100):
    DI = 100 x ( W_RULE x skor_aturan + W_ML x skor_ML + W_FIN x skor_finansial )
    W_RULE = 0.55   skor_aturan : severitas aturan terberat (0-1) + 0.05 per aturan tambahan yang ikut terpicu
    W_ML   = 0.30   skor_ML     : (persentil anomali IsolationForest - 0.95) / 0.05, dipotong ke 0-1
    W_FIN  = 0.15   skor_finans : min(1, akar(potensi selisih Rp / 20 juta))
KEPUTUSAN FLAG: aturan deterministik yang terpicu SELALU masuk antrean verifikator (hasilnya pasti & dapat ditelusuri);
ML menambah klaim yang lolos aturan hanya bila DI >= ambang (default 20 ~ 2% teratas skor anomali di antara klaim yang lolos aturan).
Label (jika ada) hanya dipakai pada tahap evaluasi, tidak pernah menjadi fitur.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import pandas as pd
from scipy.stats import chisquare, rankdata
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score, precision_recall_curve

from .explain import FEATURE_LABELS, FEATURES, ml_sentence, rule_reasons
from .ingest import Ingested
from .master import CATEGORIES, DRUGS, FAC_BY_ID, REFERENCE_CATEGORY_SHARE, normalize_name

try:  # SHAP opsional di runtime; bila gagal, status dilaporkan jujur (bukan dipalsukan)
    import shap
except Exception:  # noqa: BLE001
    shap = None

W_RULE, W_ML, W_FIN = 0.55, 0.30, 0.15
ML_PCT_FLOOR = 0.95
EPOCH = pd.Timestamp("2020-01-01")
DRUG_DF = pd.DataFrame([{"kfa": d.kfa_code, "generic": d.generic, "category": d.category, "unit": d.unit, "pack_size": d.pack_size,
                         "tol_pct": d.tol_pct, "master_price": d.unit_price} for d in DRUGS])
STAGES = [("normalize", "Normalisasi nama obat ke Kamus KFA"), ("admission", "Admission Synchronizer"),
          ("posology", "Posology Cross-Matcher"), ("package", "Package Duplication Guard"),
          ("stock", "Neraca stok deterministik"), ("ml", "IsolationForest pada fitur turunan"),
          ("score", "Discrepancy Index & status"), ("shap", "SHAP per klaim ter-flag"),
          ("reason", "Kartu penjelasan berbahasa Indonesia"), ("heatmap", "Matriks selisih & heatmap"),
          ("evaluate", "Evaluasi & validasi statistik")]


@dataclass
class EngineConfig:
    grace_days: int = 14
    di_threshold: float = 20.0
    heatmap_threshold_pct: float = 20.0
    repeat_min_days: int = 20
    package_window_days: int = 30
    sample_pct: float = 5.0
    seed: int = 20261011
    shap_cap: int = 2500
    as_of: pd.Timestamp | None = None     # None = evaluasi retrospektif: seluruh masa tenggang dianggap sudah lewat


@dataclass
class EngineResult:
    claims: pd.DataFrame
    heatmap: list[dict]
    summary: dict
    metrics: dict | None
    validation: dict
    timings: dict
    sample_ids: list[str]
    model: object = None
    X: pd.DataFrame | None = None
    explainer: object = None
    shap_status: str = ""


# ------------------------------------------------------------------------------------------ util
def _map_names(series: pd.Series) -> tuple[pd.Series, pd.Series]:
    s = series.astype(str)
    res = {u: normalize_name(u) for u in pd.unique(s)}
    return s.map(lambda u: res[u][0]), s.map(lambda u: res[u][1])


def _days(s: pd.Series) -> np.ndarray:
    return ((s - EPOCH).dt.days).to_numpy()


def _stock_ledger(c: pd.DataFrame, proc: pd.DataFrame, grace: int) -> dict[str, np.ndarray]:
    """Neraca stok kumulatif per (faskes, obat). Mengembalikan celah stok & sisa stok per baris klaim.

    Pengadaan 'terlihat' pada tanggal d bila barang sudah diterima (purchase_date <= d) DAN fakturnya sudah
    diinput. Dua tampilan: tanpa tenggang (faktur <= d) dan dengan tenggang (faktur <= d + grace).
    Klaim yang sudah ditandai aturan lain (basis=0) tidak menghabiskan stok agar tidak menimbulkan efek domino.
    """
    n = len(c)
    out = {k: np.zeros(n) for k in ("gap_known", "gap_grace", "slack_known", "slack_grace", "proc_cell_total")}
    waiting_days = np.full(n, np.nan)
    d, qty, basis, cid = _days(c.service_date), c.qty.to_numpy(float), c.basis.to_numpy(float), c.claim_id.to_numpy()
    pp = proc.dropna(subset=["kfa"])
    groups = {k: (_days(g.purchase_date), _days(g.invoice_input_date), g.qty.to_numpy(float)) for k, g in pp.groupby(["facility_id", "kfa"])}
    for key, idx in c.groupby(["facility_id", "kfa"]).indices.items():
        idx = np.asarray(idx)
        order = idx[np.lexsort((cid[idx], d[idx]))]
        b = basis[order]; before = np.cumsum(b) - b
        q, dd = qty[order], d[order]
        g = groups.get(key)
        if g is None:
            inK = inG = np.zeros(len(order)); total = 0.0; sK = cK = None
        else:
            pdays, indays, pq = g
            effK, effG = np.maximum(pdays, indays), np.maximum(pdays, indays - grace)
            oK, oG = np.argsort(effK, kind="stable"), np.argsort(effG, kind="stable")
            sK, cK = effK[oK], np.cumsum(pq[oK])
            sG, cG = effG[oG], np.cumsum(pq[oG])
            pk, pg = np.searchsorted(sK, dd, side="right"), np.searchsorted(sG, dd, side="right")
            inK = np.where(pk > 0, cK[np.clip(pk - 1, 0, None)], 0.0)
            inG = np.where(pg > 0, cG[np.clip(pg - 1, 0, None)], 0.0)
            total = float(pq.sum())
        slK, slG = inK - before, inG - before
        gK = np.minimum(q, np.maximum(0.0, q - np.maximum(slK, 0.0)))
        gG = np.minimum(q, np.maximum(0.0, q - np.maximum(slG, 0.0)))
        out["gap_known"][order], out["gap_grace"][order] = gK, gG
        out["slack_known"][order], out["slack_grace"][order] = slK, slG
        out["proc_cell_total"][order] = total
        if sK is not None:
            wait = (gK > 0) & (gG <= 0)
            if wait.any():
                k = np.searchsorted(cK, before + q, side="left")
                resolve = np.where(k < len(sK), sK[np.clip(k, 0, len(sK) - 1)], np.nan)
                waiting_days[order] = np.where(wait, resolve - dd, np.nan)
    out["waiting_days"] = waiting_days
    return out


def _metrics(y: np.ndarray, pred: np.ndarray) -> dict:
    y, pred = y.astype(int), pred.astype(int)
    tp = int(((y == 1) & (pred == 1)).sum()); fp = int(((y == 0) & (pred == 1)).sum())
    fn = int(((y == 1) & (pred == 0)).sum()); tn = int(((y == 0) & (pred == 0)).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"precision": prec, "recall": rec, "f1": f1, "fpr": fp / (fp + tn) if fp + tn else 0.0,
            "tp": tp, "fp": fp, "fn": fn, "tn": tn, "confusion_matrix": [[tn, fp], [fn, tp]], "flagged": tp + fp}


def _curve(y: np.ndarray, score: np.ndarray, max_pts: int = 120) -> dict:
    p, r, _ = precision_recall_curve(y, score)
    idx = np.unique(np.linspace(0, len(p) - 1, min(max_pts, len(p))).astype(int))
    return {"precision": p[idx].tolist(), "recall": r[idx].tolist(), "average_precision": float(average_precision_score(y, score))}


def shap_single(model, X: pd.DataFrame, i: int, explainer=None) -> list[dict]:
    """SHAP untuk satu klaim (dipakai Claim Inspector bila belum dihitung massal)."""
    if shap is None:
        return []
    explainer = explainer or shap.TreeExplainer(model)
    sv = explainer.shap_values(X.iloc[[i]], check_additivity=False)
    push = -np.asarray(sv[0] if isinstance(sv, list) else sv)[0]
    order = np.argsort(-np.abs(push))[:6]
    return [{"feature": FEATURES[j], "label": FEATURE_LABELS[FEATURES[j]], "value": float(X.iloc[i, j]), "contribution": float(push[j]),
             "text": ml_sentence(FEATURES[j], X.iloc[i, j])} for j in order]


def draw_sample(ids: list[str], pct: float, seed: int) -> list[str]:
    if not ids:
        return []
    k = min(len(ids), max(1, int(round(len(ids) * pct / 100.0))))
    rng = np.random.default_rng(seed)
    return sorted(rng.choice(np.array(ids), size=k, replace=False).tolist())


# ------------------------------------------------------------------------------------------ engine
def run_engine(ing: Ingested, cfg: EngineConfig, labels: pd.DataFrame | None = None,
               on_stage: Callable[[str, str, float | None], None] | None = None, target_records: int | None = None) -> EngineResult:
    timings: dict[str, float] = {}

    @contextmanager
    def stage(key: str):
        if on_stage:
            on_stage(key, "start", None)
        t0 = time.perf_counter()
        yield
        timings[key] = time.perf_counter() - t0
        if on_stage:
            on_stage(key, "end", timings[key])

    p, c, enc, med = ing.proc.copy(), ing.claims.copy(), ing.enc, ing.med
    n = len(c)

    # ---------------------------------------------------------------- 1. normalisasi
    with stage("normalize"):
        c["kfa"], c["norm_method"] = _map_names(c["drug_name"])
        p["kfa"], p["norm_method"] = _map_names(p["drug_name"])
        med = med.copy(); med["kfa"], med["norm_method"] = _map_names(med["name"])
        c = c.merge(DRUG_DF, on="kfa", how="left")
        c["unmapped"] = c["kfa"].isna()
        c["category"] = c["category"].fillna("Tidak terpetakan")
        c["generic"] = c["generic"].fillna(c["drug_name"]); c["unit"] = c["unit"].fillna("unit")
        c["pack_size"] = c["pack_size"].fillna(1.0); c["tol_pct"] = c["tol_pct"].fillna(0.0)
        p = p.merge(DRUG_DF[["kfa", "category"]], on="kfa", how="left")
        c["facility_name"] = c["facility_id"].map(lambda f: FAC_BY_ID[f].name if f in FAC_BY_ID else f)
        c["peer_class"] = c["facility_id"].map(lambda f: FAC_BY_ID[f].klass if f in FAC_BY_ID else "Tidak diketahui")
        c["qty"] = c["qty"].astype(float)

    # ---------------------------------------------------------------- 2. Admission Synchronizer
    with stage("admission"):
        e = enc[["enc_id", "pid", "fac", "start", "end"]].rename(columns={"pid": "enc_pid", "fac": "enc_fac", "start": "enc_start", "end": "enc_end"})
        e = e.drop_duplicates("enc_id")
        c = c.merge(e, left_on="rme_encounter_ref", right_on="enc_id", how="left")
        found = c["enc_pid"].notna()
        c["adm_missing"] = ~found
        c["adm_patient"] = found & (c["enc_pid"] != c["pid"])
        c["adm_facility"] = found & ~c["adm_patient"] & (c["enc_fac"] != c["facility_id"])
        day = pd.Timedelta(days=1)
        c["adm_date"] = found & ((c["service_date"] < c["enc_start"] - day) | (c["service_date"] > c["enc_end"] + day))

    # ---------------------------------------------------------------- 3. Posology Cross-Matcher
    with stage("posology"):
        mj = med[(med["payer"] == "JKN") & med["kfa"].notna()]
        magg = mj.groupby(["enc_ref", "kfa"], as_index=False).agg(rme_dose=("dose", "sum"), rme_lines=("med_id", "count"))
        c = c.merge(magg, left_on=["rme_encounter_ref", "kfa"], right_on=["enc_ref", "kfa"], how="left")
        c["rme_found"] = c["rme_lines"].notna()
        dose = c["rme_dose"].fillna(0.0)
        c["rme_exact"] = np.where(c["rme_found"], dose / c["pack_size"], 0.0)
        c["rme_expected"] = np.where(c["rme_found"], np.ceil(c["rme_exact"] - 1e-9).clip(lower=1), 0.0)   # pembulatan ke atas = wastage wajar
        c["tol_units"] = np.floor(c["rme_expected"] * c["tol_pct"] + 1e-9)
        c["rule_rme_missing"] = ~c["rme_found"] & ~c["unmapped"]
        c["pos_excess"] = np.where(c["rme_found"], np.maximum(0.0, c["qty"] - (c["rme_expected"] + c["tol_units"])), 0.0)
        c["rule_pos_excess"] = c["pos_excess"] > 0

    # ---------------------------------------------------------------- 4. Package Duplication Guard + penagihan berulang
    with stage("package"):
        prb = c.loc[c["claim_channel"] == "PRB", ["claim_id", "pid", "kfa", "service_date"]]
        ina = c.loc[c["claim_channel"] == "INA-CBG", ["pid", "kfa", "service_date"]].rename(columns={"service_date": "ina_date"})
        mm = prb.merge(ina, on=["pid", "kfa"])
        mm["gap"] = (mm["service_date"] - mm["ina_date"]).abs().dt.days
        mm = mm[mm["gap"] <= cfg.package_window_days].groupby("claim_id", as_index=False)["gap"].min()
        c = c.merge(mm.rename(columns={"gap": "pkg_gap_days"}), on="claim_id", how="left")
        c["pkg_dup"] = c["pkg_gap_days"].notna()
        c["pkg_gap_days"] = c["pkg_gap_days"].fillna(0.0)
        s = c.loc[c["claim_channel"] == "PRB", ["claim_id", "pid", "kfa", "service_date"]].sort_values(["pid", "kfa", "service_date", "claim_id"])
        s["refill_gap_days"] = s.groupby(["pid", "kfa"])["service_date"].diff().dt.days
        c = c.merge(s[["claim_id", "refill_gap_days"]], on="claim_id", how="left")
        c["repeat_billing"] = c["refill_gap_days"].notna() & (c["refill_gap_days"] < cfg.repeat_min_days)

    # ---------------------------------------------------------------- 5. Neraca stok
    with stage("stock"):
        hard_other = c[["adm_missing", "adm_patient", "adm_facility", "adm_date", "pkg_dup", "repeat_billing", "rule_rme_missing"]].any(axis=1)
        c["basis"] = np.where(hard_other, 0.0, np.minimum(c["qty"], c["rme_expected"] + c["tol_units"]))
        led = _stock_ledger(c, p, cfg.grace_days)
        for k in ("gap_known", "gap_grace", "slack_known", "slack_grace", "proc_cell_total", "waiting_days"):
            c[k] = led[k]
        mappable = ~c["unmapped"]
        c["rule_stock"] = mappable & (c["gap_grace"] > 0)
        wait = mappable & (c["gap_known"] > 0) & (c["gap_grace"] <= 0)
        if cfg.as_of is not None:   # mode produksi: tenggang belum lewat -> kekurangan stok masih 'menunggu'
            pending = (c["service_date"] + pd.Timedelta(days=cfg.grace_days)) > cfg.as_of
            wait = wait | (c["rule_stock"] & pending)
            c["rule_stock"] = c["rule_stock"] & ~pending
        c["waiting"] = wait

    # ---------------------------------------------------------------- 6. fitur + IsolationForest
    with stage("ml"):
        q = c["qty"].replace(0, np.nan)
        f = pd.DataFrame(index=c.index)
        f["f_stock_gap_ratio"] = (c["gap_grace"] / q).fillna(0.0)
        f["f_stock_slack_ratio"] = (c["slack_grace"].clip(lower=0) / q).clip(upper=5).fillna(0.0)
        f["f_posology_ratio"] = np.where(c["rme_expected"] > 0, c["qty"] / c["rme_expected"].replace(0, np.nan), 0.0)
        f["f_rme_missing"] = (~c["rme_found"]).astype(float)
        dose_basis = np.where(c["rme_found"], c["rme_expected"], c["qty"])
        grp = [c["kfa"].fillna("-"), c["peer_class"]]
        for col, src in (("f_dose_peer_z", pd.Series(dose_basis, index=c.index)), ("f_qty_peer_z", c["qty"])):
            g = src.groupby(grp)
            f[col] = ((src - g.transform("mean")) / g.transform("std").replace(0, np.nan)).fillna(0.0)
        fd = c.groupby(["facility_id", "kfa", "peer_class"], dropna=False).agg(units=("qty", "sum"), pats=("pid", "nunique")).reset_index()
        fd["ratio"] = fd["units"] / fd["pats"].clip(lower=1)
        fd["peer_mean"] = fd.groupby(["kfa", "peer_class"], dropna=False)["ratio"].transform("mean").replace(0, np.nan)
        fd["f_fac_ratio"] = (fd["ratio"] / fd["peer_mean"]).fillna(1.0)
        f["f_fac_ratio"] = c[["facility_id", "kfa", "peer_class"]].merge(fd[["facility_id", "kfa", "peer_class", "f_fac_ratio"]], how="left", on=["facility_id", "kfa", "peer_class"])["f_fac_ratio"].fillna(1.0).to_numpy()
        dl = c.groupby(["facility_id", "kfa", "did"]).claim_id.transform("count")
        fl = c.groupby(["facility_id", "kfa"]).claim_id.transform("count")
        f["f_doctor_conc"] = (dl / fl).fillna(0.0)
        f["f_patient_drug_lines"] = c.groupby(["pid", "kfa"]).claim_id.transform("count").astype(float)
        f["f_refill_gap"] = c["refill_gap_days"].fillna(60.0).clip(0, 60)
        f["f_value_log"] = np.log10(c["amount"].astype(float) + 1.0)
        X = f[FEATURES].replace([np.inf, -np.inf], 0.0).fillna(0.0).astype(float)
        model = IsolationForest(n_estimators=150, max_samples=min(256, n), contamination="auto", random_state=cfg.seed)
        model.fit(X)
        c["ml_raw"] = -model.score_samples(X)
        c["ml_pct"] = rankdata(c["ml_raw"]) / n   # dihitung ulang pada tahap score terhadap populasi yang lolos aturan

    # ---------------------------------------------------------------- 8. skor, DI, status (dihitung sebelum SHAP agar tahu baris mana yang dijelaskan)
    with stage("score"):
        sev = pd.DataFrame(index=c.index)
        sev["Neraca stok"] = np.where(c["rule_stock"], np.minimum(1.0, 0.55 + 0.45 * c["gap_grace"] / c["qty"].replace(0, np.nan)).fillna(0.55), 0.0)
        sev["Posologi RME"] = np.where(c["rule_pos_excess"], np.minimum(1.0, 0.6 + 0.4 * np.minimum(c["pos_excess"] / c["rme_expected"].replace(0, np.nan), 1.0).fillna(1.0)), 0.0)
        sev["Posologi RME"] = np.maximum(sev["Posologi RME"], np.where(c["rule_rme_missing"], 0.9, 0.0))
        sev["Admission"] = np.maximum.reduce([np.where(c["adm_missing"], 0.95, 0.0), np.where(c["adm_patient"], 0.95, 0.0),
                                              np.where(c["adm_facility"], 0.9, 0.0), np.where(c["adm_date"], 0.8, 0.0)])
        sev["Paket/Refill"] = np.maximum(np.where(c["pkg_dup"], 0.9, 0.0), np.where(c["repeat_billing"], 0.8, 0.0))
        sev["Nama obat"] = np.where(c["unmapped"], 0.5, 0.0)
        n_rules = (sev > 0).sum(axis=1)
        raw = sev.max(axis=1)
        c["rule_flag"] = n_rules > 0
        # ML bertugas menangkap pola janggal yang LOLOS aturan -> persentil anomali dihitung terhadap klaim yang lolos aturan
        ref = np.sort(c.loc[~c["rule_flag"], "ml_raw"].to_numpy())
        c["ml_pct"] = np.searchsorted(ref, c["ml_raw"].to_numpy(), side="right") / max(len(ref), 1)
        c["ml_score"] = ((c["ml_pct"] - ML_PCT_FLOOR) / (1 - ML_PCT_FLOOR)).clip(0, 1)
        if len(ref) < 100:   # populasi pembanding terlalu kecil -> ML tidak diaktifkan (hindari persentil semu)
            c["ml_score"] = 0.0
        c["rule_score"] = np.where(c["rule_flag"], np.minimum(1.0, raw + 0.05 * (n_rules - 1).clip(lower=0)), 0.0)
        c["primary_rule"] = np.where(c["rule_flag"], sev.idxmax(axis=1), "")
        c["sev_stock"], c["sev_pos"] = sev["Neraca stok"], sev["Posologi RME"]
        susp = np.maximum.reduce([
            np.where(c["rule_stock"], c["gap_grace"], 0.0), c["pos_excess"].to_numpy(),
            np.where(c[["adm_missing", "adm_patient", "adm_facility", "adm_date", "pkg_dup", "repeat_billing", "rule_rme_missing"]].any(axis=1), c["qty"], 0.0)])
        c["suspicious_qty"] = susp
        c["potential_difference"] = susp * c["unit_price"]
        c["held_value"] = np.where(c["waiting"] & ~c["rule_flag"], c["gap_known"] * c["unit_price"], 0.0)
        c["fin_score"] = np.minimum(1.0, np.sqrt(c["potential_difference"] / 20_000_000))
        c["rule_part"], c["ml_part"], c["fin_part"] = 100 * W_RULE * c["rule_score"], 100 * W_ML * c["ml_score"], 100 * W_FIN * c["fin_score"]
        c["di"] = (c["rule_part"] + c["ml_part"] + c["fin_part"]).clip(0, 100).round(1)
        c["ml_only"] = ~c["rule_flag"] & (c["ml_score"] > 0) & (c["di"] >= cfg.di_threshold)
        c["flagged"] = c["rule_flag"] | c["ml_only"]
        c.loc[c["ml_only"], "primary_rule"] = "ML saja"
        c["status"] = np.select([c["flagged"], c["waiting"]], ["Perlu review verifikator", "Menunggu verifikasi faktur"], "Selaras")
        c["priority"] = np.select([c["flagged"] & (c["di"] >= 70), c["flagged"] & (c["di"] >= 40), c["flagged"]], ["Tinggi", "Sedang", "Rendah"], "")

    # ---------------------------------------------------------------- 7. SHAP
    shap_rows: dict[int, list[dict]] = {}
    explainer, shap_status = None, ""
    with stage("shap"):
        idx = c.index[c["flagged"]].to_numpy()
        idx = idx[np.argsort(-c.loc[idx, "di"].to_numpy())][: cfg.shap_cap]
        if shap is None:
            shap_status = "Pustaka SHAP tidak tersedia — penjelasan ML tidak ditampilkan."
        elif len(idx) == 0:
            shap_status = "Tidak ada klaim ter-flag."
        else:
            try:
                explainer = shap.TreeExplainer(model)
                sv = explainer.shap_values(X.iloc[idx], check_additivity=False)
                sv = np.asarray(sv[0] if isinstance(sv, list) else sv)
                for row, i in enumerate(idx):
                    push = -sv[row]      # SHAP IsolationForest: nilai negatif = lebih anomali -> dibalik: positif = mendorong anomali
                    order = np.argsort(-np.abs(push))[:6]
                    shap_rows[int(i)] = [{"feature": FEATURES[j], "label": FEATURE_LABELS[FEATURES[j]], "value": float(X.iloc[i, j]),
                                          "contribution": float(push[j]), "text": ml_sentence(FEATURES[j], X.iloc[i, j])} for j in order]
                shap_status = f"SHAP TreeExplainer dihitung untuk {len(idx)} klaim ter-flag teratas (batas {cfg.shap_cap})."
            except Exception as exc:  # noqa: BLE001
                shap_status = f"SHAP gagal dihitung: {type(exc).__name__}. Penjelasan aturan tetap tersedia."

    # ---------------------------------------------------------------- reason text
    with stage("reason"):
        c["shap"] = [shap_rows.get(i) for i in range(n)]
        c["reason"] = "Tidak ditemukan selisih pada triangulasi 3 pintu."
        sel = c.index[c["flagged"] | c["waiting"]]
        cols = ["unit", "generic", "facility_name", "qty", "slack_grace", "proc_cell_total", "rme_expected", "rme_found", "rule_stock", "rule_rme_missing",
                "rule_pos_excess", "pos_excess", "adm_missing", "adm_patient", "adm_facility", "adm_date", "pkg_dup", "pkg_gap_days", "repeat_billing",
                "refill_gap_days", "unmapped", "sev_stock", "sev_pos", "waiting", "waiting_days", "flagged", "ml_only", "rule_flag"]
        recs = c.loc[sel, cols].to_dict("records")
        for i, r in zip(sel, recs):
            r["slack"] = r["slack_grace"]
            parts = rule_reasons(r)
            if r["waiting"] and not r["rule_flag"]:
                d = r["waiting_days"]
                lag = f"faktur pengadaan baru masuk ±{int(d)} hari kemudian" if d == d else "faktur pengadaan belum terlihat"
                parts.append(f"Pengadaan {r['generic']} belum tercatat pada tanggal klaim; {lag}, masih dalam masa tenggang {cfg.grace_days} hari → "
                             "status Menunggu verifikasi faktur (bukan penolakan).")
            sh = shap_rows.get(int(i))
            if sh and r["flagged"]:
                top = [s for s in sh if s["contribution"] > 0][:2]
                if top:
                    parts.append("Faktor ML: " + " ".join(s["text"] for s in top))
            if r["ml_only"] and not parts:
                parts.append("Lolos aturan, tetapi pola transaksi menyimpang dari faskes sejenis (skor anomali ML tinggi).")
            c.at[i, "reason"] = " ".join(parts) if parts else c.at[i, "reason"]
        c["recommendation"] = np.select(
            [c["flagged"] & (c["di"] >= 70), c["flagged"] & c["rule_flag"], c["ml_only"], c["waiting"]],
            ["Prioritas tinggi: tinjau bukti 3 pintu, lalu pertimbangkan Minta Klarifikasi RS", "Tinjau bukti dan minta klarifikasi RS bila selisih tidak terjelaskan",
             "Tinjau pola terhadap faskes sejenis (tanpa pelanggaran aturan)", "Tunggu faktur pengadaan masuk (maks. masa tenggang)"], "")

    # ---------------------------------------------------------------- heatmap
    with stage("heatmap"):
        pc = p.dropna(subset=["category"]).assign(value=lambda d: d["qty"] * d["unit_price"]).groupby(["facility_id", "category"])["value"].sum().rename("proc_value")
        hm = c[c["category"].isin(CATEGORIES)].groupby(["facility_id", "category"]).agg(
            claim_value=("amount", "sum"), claim_lines=("claim_id", "count"), flagged=("flagged", "sum"),
            flagged_value=("potential_difference", lambda s: float(s[c.loc[s.index, "flagged"]].sum()))).reset_index()
        hm = hm.merge(pc.reset_index(), on=["facility_id", "category"], how="left").fillna({"proc_value": 0.0})
        hm["diff_pct"] = np.where(hm["proc_value"] > 0, np.maximum(0.0, (hm["claim_value"] - hm["proc_value"]) / hm["proc_value"] * 100), np.where(hm["claim_value"] > 0, 999.0, 0.0))
        heatmap = [{"facility_id": r.facility_id, "facility_name": FAC_BY_ID[r.facility_id].name if r.facility_id in FAC_BY_ID else r.facility_id,
                    "peer_class": FAC_BY_ID[r.facility_id].klass if r.facility_id in FAC_BY_ID else "Tidak diketahui", "category": r.category,
                    "claim_value": float(r.claim_value), "proc_value": float(r.proc_value), "diff_pct": float(round(r.diff_pct, 1)),
                    "claim_lines": int(r.claim_lines), "flagged": int(r.flagged), "flagged_value": float(r.flagged_value)} for r in hm.itertuples()]

    # ---------------------------------------------------------------- evaluasi & validasi
    with stage("evaluate"):
        metrics = _evaluate(c, labels) if labels is not None and len(labels) else None
        validation = _validate(c, p, med, ing, labels, target_records)
        elig = c.loc[c["status"] == "Selaras", "claim_id"].tolist()
        sample_ids = draw_sample(elig, cfg.sample_pct, cfg.seed)

    process_seconds = sum(timings.values())
    flagged_rows = c[c["flagged"]]
    summary = {
        "records": int(n), "flagged": int(c["flagged"].sum()), "flagged_pct": float(c["flagged"].mean() * 100),
        "rule_flagged": int(c["rule_flag"].sum()), "ml_only_flagged": int(c["ml_only"].sum()), "waiting_invoice": int((c["waiting"] & ~c["flagged"]).sum()),
        "potential_difference": float(flagged_rows["potential_difference"].sum()), "held_value": float(c["held_value"].sum()),
        "process_seconds": float(process_seconds), "stage_seconds": {k: float(v) for k, v in timings.items()},
        "claim_value_total": float(c["amount"].sum()), "high_priority": int((c["priority"] == "Tinggi").sum()),
        "facilities": int(c["facility_id"].nunique()), "shap_status": shap_status, "sample_size": len(sample_ids),
        "config": {"grace_days": cfg.grace_days, "di_threshold": cfg.di_threshold, "heatmap_threshold_pct": cfg.heatmap_threshold_pct,
                   "w_rule": W_RULE, "w_ml": W_ML, "w_fin": W_FIN, "retrospective": cfg.as_of is None},
    }
    return EngineResult(c, heatmap, summary, metrics, validation, timings, sample_ids, model, X, explainer, shap_status)


# ------------------------------------------------------------------------------------------ evaluasi
def _evaluate(c: pd.DataFrame, labels: pd.DataFrame) -> dict | None:
    lab = labels.drop_duplicates("claim_id").set_index("claim_id")
    j = c.join(lab[["label_fraud", "scenario", "variant"]], on="claim_id", how="inner")
    if j.empty:
        return None
    y = j["label_fraud"].astype(int).to_numpy()
    naive = (j["rule_rme_missing"] | (j["qty"] > j["rme_exact"] + 1e-9)).to_numpy()
    rules, hybrid = j["rule_flag"].to_numpy(), j["flagged"].to_numpy()
    out: dict = {
        "n_evaluated": int(len(j)), "n_fraud": int(y.sum()), "coverage": float(len(j) / len(c)),
        "naive": _metrics(y, naive), "rule_only": _metrics(y, rules), "hybrid": _metrics(y, hybrid),
        "pr": {"naive": None, "rule_only": _curve(y, j["rule_score"].to_numpy()), "hybrid": _curve(y, j["di"].to_numpy()), "ml_only": _curve(y, j["ml_raw"].to_numpy())},
    }
    naive_m = out["naive"]
    out["pr"]["naive"] = {"precision": naive_m["precision"], "recall": naive_m["recall"]}
    rows = []
    for (scen, var), g in j[j["label_fraud"] == 1].groupby(["scenario", "variant"]):
        rows.append({"scenario": scen, "variant": var, "n": int(len(g)), "caught_rules": int(g["rule_flag"].sum()), "caught_hybrid": int(g["flagged"].sum()),
                     "recall_rules": float(g["rule_flag"].mean()), "recall_hybrid": float(g["flagged"].mean())})
    out["by_scenario"] = rows
    clean = j[j["label_fraud"] == 0]
    out["fpr_by_peer_class"] = [{"peer_class": k, "n_clean": int(len(g)), "fp": int(g["flagged"].sum()), "fpr": float(g["flagged"].mean())}
                                for k, g in clean.groupby("peer_class")]
    fp = clean[clean["flagged"]]
    out["fp_by_rule"] = [{"rule": k or "-", "n": int(v)} for k, v in fp["primary_rule"].value_counts().items()]
    sweep = []
    for t in (0, 5, 10, 15, 20, 25, 30, 40):
        pred = j["rule_flag"] | ((j["ml_score"] > 0) & (j["di"] >= t))
        m = _metrics(y, pred.to_numpy()); sweep.append({"di_threshold": t, **{k: m[k] for k in ("precision", "recall", "f1", "fpr", "flagged")}})
    out["threshold_sweep"] = sweep
    ml = _metrics(y, j["ml_only"].to_numpy() | False)
    out["ml_contribution"] = {"extra_tp": int((j["ml_only"] & (j["label_fraud"] == 1)).sum()), "extra_fp": int((j["ml_only"] & (j["label_fraud"] == 0)).sum()), "ml_only_total": int(j["ml_only"].sum())}
    missed = j[(j["label_fraud"] == 1) & ~j["flagged"]]
    out["fn_total_value"] = float((missed["amount"]).sum())
    out["fn_rate_auto_pass"] = float(((j["label_fraud"] == 1) & (j["status"] != "Perlu review verifikator")).sum() / max(1, (j["status"] != "Perlu review verifikator").sum()))
    del ml
    return out


def _validate(c: pd.DataFrame, p: pd.DataFrame, med: pd.DataFrame, ing: Ingested, labels: pd.DataFrame | None, target: int | None) -> dict:
    obs = c["category"].value_counts().reindex(CATEGORIES, fill_value=0)
    exp = np.array([REFERENCE_CATEGORY_SHARE[k] for k in CATEGORIES]); exp = exp / exp.sum() * obs.sum()
    cat = chisquare(obs.to_numpy(), exp)
    fids = [f for f in FAC_BY_ID if f in set(c["facility_id"])]
    fobs = c["facility_id"].value_counts().reindex(fids, fill_value=0)
    fexp = np.array([FAC_BY_ID[f].weight for f in fids]); fexp = fexp / fexp.sum() * fobs.sum()
    fac = chisquare(fobs.to_numpy(), fexp) if len(fids) > 1 else None
    delay = (p["invoice_input_date"] - p["purchase_date"]).dt.days
    grace = 14
    out = {
        "counts": {**ing.counts, "target_per_door": target},
        "chi_square": [
            {"name": "Distribusi kategori obat vs acuan desain", "statistic": float(cat.statistic), "p_value": float(cat.pvalue), "dof": len(CATEGORIES) - 1,
             "labels": CATEGORIES, "observed": obs.astype(int).tolist(), "expected": [float(x) for x in exp]},
            *([{"name": "Distribusi volume klaim per faskes vs bobot volume desain", "statistic": float(fac.statistic), "p_value": float(fac.pvalue), "dof": len(fids) - 1,
                "labels": fids, "observed": fobs.astype(int).tolist(), "expected": [float(x) for x in fexp]}] if fac is not None else []),
        ],
        "cross_door": {
            "claims_with_rme_encounter_pct": float((~c["adm_missing"]).mean() * 100),
            "claims_with_rme_medication_pct": float(c["rme_found"].mean() * 100),
            "claims_with_any_procurement_pct": float((c["proc_cell_total"] > 0).mean() * 100),
            "name_mapping": {door: {m: int(v) for m, v in df["norm_method"].value_counts().items()} for door, df in (("klaim", c), ("procurement", p), ("rme", med))},
            "unmapped_claim_names": int(c["unmapped"].sum()),
        },
        "traps_observed": {
            "faktur_terlambat_dalam_tenggang": int(((delay > 1) & (delay <= grace)).sum()),
            "faktur_terlambat_lewat_tenggang": int((delay > grace).sum()),
            "pembelian_non_ekatalog": int((p["channel"] != "e-Katalog").sum()),
            "klaim_menunggu_faktur": int((c["waiting"] & ~c["flagged"]).sum()),
            "wastage_wajar_tidak_ditandai": int(((c["qty"] > c["rme_exact"] + 1e-9) & c["rme_found"] & ~c["rule_pos_excess"]).sum()),
            "nama_merek_bukan_generik": int((p["norm_method"].isin(["exact", "fuzzy"]) & ~p["drug_name"].str.lower().isin([d.generic.lower() for d in DRUGS])).sum()),
            "nama_diperbaiki_fuzzy": int((c["norm_method"] == "fuzzy").sum() + (p["norm_method"] == "fuzzy").sum() + (med["norm_method"] == "fuzzy").sum()),
        },
        "period": {"claims": [str(c["service_date"].min().date()), str(c["service_date"].max().date())],
                   "procurement": [str(p["purchase_date"].min().date()), str(p["purchase_date"].max().date())]},
        "label_available": labels is not None and len(labels) > 0,
    }
    for t in out["chi_square"]:
        tot = max(sum(t["observed"]), 1)
        t["effect_size_w"] = float((t["statistic"] / tot) ** 0.5)   # Cohen's w: <0,1 kecil, 0,3 sedang, >0,5 besar
    if labels is not None and len(labels):
        j = labels[labels["label_fraud"] == 1]
        out["injected"] = {"fraud_lines": int(len(j)), "fraud_pct": float(len(j) / len(labels) * 100), "by_scenario": j["scenario"].value_counts().to_dict()}
    return out
