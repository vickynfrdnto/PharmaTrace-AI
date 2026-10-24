"""Penjelasan berbahasa Indonesia untuk verifikator (kartu alasan + label fitur SHAP)."""
from __future__ import annotations

FEATURE_LABELS = {
    "f_stock_gap_ratio": "Porsi klaim yang tidak punya pengadaan",
    "f_stock_slack_ratio": "Sisa stok pengadaan saat klaim",
    "f_posology_ratio": "Rasio klaim terhadap dosis RME",
    "f_rme_missing": "Pemberian obat tidak tercatat di RME",
    "f_dose_peer_z": "Dosis RME vs faskes sejenis",
    "f_qty_peer_z": "Volume klaim vs faskes sejenis",
    "f_fac_ratio": "Rasio obat/pasien faskes vs peer group",
    "f_doctor_conc": "Konsentrasi klaim pada satu dokter",
    "f_patient_drug_lines": "Frekuensi klaim obat sama pada pasien",
    "f_refill_gap": "Jarak refill obat yang sama",
    "f_value_log": "Nilai klaim (skala log)",
}
FEATURES = list(FEATURE_LABELS)


def rupiah(x: float) -> str:
    x = float(x)
    if x >= 1e9:
        return f"Rp {x / 1e9:.1f} M".replace(".", ",")
    if x >= 1e6:
        return f"Rp {x / 1e6:.1f} jt".replace(".", ",")
    if x >= 1e3:
        return f"Rp {x / 1e3:.0f} rb"
    return f"Rp {x:.0f}"


def _n(x: float) -> str:
    return f"{int(round(x))}" if abs(x - round(x)) < 1e-9 else f"{x:.1f}".replace(".", ",")


def ml_sentence(feature: str, value: float) -> str:
    v = float(value)
    return {
        "f_stock_gap_ratio": f"{v * 100:.0f}% volume klaim tidak tertutup pengadaan.",
        "f_stock_slack_ratio": f"Sisa stok pengadaan hanya {v:.1f}× volume klaim.",
        "f_posology_ratio": f"Volume klaim {v:.1f}× dari yang wajar menurut dosis RME.",
        "f_rme_missing": "Tidak ada catatan pemberian obat di RME untuk klaim ini.",
        "f_dose_peer_z": f"Dosis/volume di RME {v:+.1f} simpangan baku dari faskes sejenis.",
        "f_qty_peer_z": f"Volume klaim {v:+.1f} simpangan baku dari faskes sejenis.",
        "f_fac_ratio": f"Rasio obat per pasien faskes {v:.1f}× rata-rata peer group.",
        "f_doctor_conc": f"Satu dokter menyumbang {v * 100:.0f}% klaim obat ini di faskes.",
        "f_patient_drug_lines": f"Pasien yang sama diklaim obat ini {int(round(v))}× pada periode data.",
        "f_refill_gap": f"Jarak ke klaim obat yang sama sebelumnya {v:.0f} hari.",
        "f_value_log": f"Nilai klaim relatif besar (log10 = {v:.1f}).",
    }.get(feature, FEATURE_LABELS.get(feature, feature))


def rule_reasons(r: dict) -> list[str]:
    """Kalimat alasan deterministik dari aturan, urut dari yang paling berat."""
    u = r["unit"]
    out: list[tuple[float, str]] = []
    if r["rule_stock"]:
        if r["proc_cell_total"] <= 0:
            tail = f"tidak ada pembelian {r['generic']} sama sekali di {r['facility_name']} pada periode data (0 {u})"
        else:
            tail = f"stok hasil pengadaan yang tersedia hanya {_n(max(r['slack'], 0))} {u} (total pengadaan periode {_n(r['proc_cell_total'])} {u})"
        rme = f"RME {_n(r['rme_expected'])} {u}" if r["rme_found"] else "RME tidak mencatat pemberiannya"
        out.append((r["sev_stock"], f"Ditandai karena klaim {_n(r['qty'])} {u} sedangkan {tail} dan {rme}."))
    if r["rule_rme_missing"] and not r["rule_stock"]:
        out.append((0.9, f"Klaim {_n(r['qty'])} {u} {r['generic']} tidak punya catatan pemberian obat di RME untuk kunjungan tersebut."))
    if r["rule_pos_excess"]:
        out.append((r["sev_pos"], f"Posology Cross-Matcher: dosis RME setara {_n(r['rme_expected'])} {u}, tetapi klaim {_n(r['qty'])} {u} (selisih {_n(r['pos_excess'])} {u} di atas batas wajar)."))
    if r["adm_missing"]:
        out.append((0.95, "Admission Synchronizer: kunjungan/encounter yang dirujuk klaim tidak ditemukan di RME — resep tanpa kunjungan."))
    if r["adm_patient"]:
        out.append((0.95, "Admission Synchronizer: identitas pasien pada klaim berbeda dengan pasien pada kunjungan RME yang dirujuk."))
    if r["adm_facility"]:
        out.append((0.9, "Admission Synchronizer: faskes pada klaim berbeda dengan faskes penyelenggara kunjungan di RME."))
    if r["adm_date"]:
        out.append((0.8, "Admission Synchronizer: tanggal layanan pada klaim berada di luar periode kunjungan RME."))
    if r["pkg_dup"]:
        out.append((0.9, f"Package Duplication Guard: obat yang sama pada pasien yang sama sudah tercakup paket INA-CBG (selisih {int(r['pkg_gap_days'])} hari) tetapi ditagih lagi lewat PRB."))
    if r["repeat_billing"]:
        out.append((0.8, f"Penagihan berulang: klaim PRB obat yang sama hanya {int(r['refill_gap_days'])} hari setelah klaim sebelumnya (batas wajar refill ≥ 20 hari)."))
    if r["unmapped"]:
        out.append((0.5, "Nama obat tidak dapat dipetakan ke Kamus KFA — perlu verifikasi manual."))
    out.sort(key=lambda t: -t[0])
    return [s for _, s in out]
