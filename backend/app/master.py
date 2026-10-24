"""Master data mini bergaya Kamus Farmasi & Alat Kesehatan (KFA) + master faskes sintetis.

Seluruh isi file ini fiktif dan hanya untuk demo. Kode KFA di sini BUKAN kode resmi Kemenkes.
"""
from __future__ import annotations

import difflib
import math
import re
from dataclasses import dataclass

CATEGORIES = ["Onkologi", "Albumin", "PRB", "Antibiotik", "Infus", "Alkes"]


@dataclass(frozen=True)
class Drug:
    kfa_code: str
    generic: str
    category: str
    unit: str            # satuan klaim (vial, tablet, kolf, pcs)
    dose_unit: str       # satuan dosis di RME (mg, mL, tablet, ...)
    pack_size: int       # berapa dose_unit per 1 satuan klaim
    unit_price: int      # Rp per satuan klaim (sintetis)
    brands: tuple[str, ...]
    dose_range: tuple[int, int]
    max_rank: int        # dipasok oleh faskes dengan rank <= max_rank (1 = hanya Kelas A)
    tol_pct: float = 0.0  # toleransi selisih klaim vs RME (mis. sisa blister tablet)

    @property
    def aliases(self) -> list[str]:
        return [self.generic, *self.brands]


DRUGS: list[Drug] = [
    Drug("KFA-ONC-001", "Paclitaxel 100 mg Injeksi", "Onkologi", "vial", "mg", 100, 1_850_000, ("Taxol", "Pacli", "Paxus", "Paclitaxel Inj"), (120, 360), 2),
    Drug("KFA-ONC-002", "Trastuzumab 440 mg Injeksi", "Onkologi", "vial", "mg", 440, 12_500_000, ("Herceptin", "Herzuma", "Ogivri", "Trastuzumab 440"), (440, 880), 1),
    Drug("KFA-ONC-003", "Bevacizumab 100 mg Injeksi", "Onkologi", "vial", "mg", 100, 3_900_000, ("Avastin", "Zirabev", "Bevacizumab 100"), (300, 900), 1),
    Drug("KFA-ONC-004", "Docetaxel 80 mg Injeksi", "Onkologi", "vial", "mg", 80, 2_300_000, ("Taxotere", "Docefrez", "Docetaxel 80mg"), (100, 200), 2),
    Drug("KFA-ONC-005", "Cisplatin 50 mg Injeksi", "Onkologi", "vial", "mg", 50, 420_000, ("Platinol", "Kemoplat", "Cisplatin 50mg"), (60, 120), 3),
    Drug("KFA-ONC-006", "Carboplatin 450 mg Injeksi", "Onkologi", "vial", "mg", 450, 1_350_000, ("Paraplatin", "Carbosin", "Carboplatin 450"), (300, 700), 3),
    Drug("KFA-ALB-001", "Human Albumin 20% 100 mL", "Albumin", "vial", "mL", 100, 2_900_000, ("Albutein", "Albumin Human 20%", "Albunate", "Alburx"), (100, 300), 2),
    Drug("KFA-ALB-002", "Human Albumin 25% 50 mL", "Albumin", "vial", "mL", 50, 1_650_000, ("Plasbumin-25", "Albumin 25% 50mL", "Albuminar-25"), (50, 150), 3),
    Drug("KFA-PRB-001", "Metformin 500 mg Tablet", "PRB", "tablet", "tablet", 1, 900, ("Glucophage", "Glucotika", "Metformin HCl 500"), (28, 90), 4, 0.08),
    Drug("KFA-PRB-002", "Amlodipine 10 mg Tablet", "PRB", "tablet", "tablet", 1, 1_400, ("Norvask", "Tensivask", "Amlodipine Besylate"), (28, 90), 4, 0.08),
    Drug("KFA-PRB-003", "Simvastatin 20 mg Tablet", "PRB", "tablet", "tablet", 1, 1_100, ("Zocor", "Simvastatin 20", "Simvast"), (28, 90), 4, 0.08),
    Drug("KFA-PRB-004", "Glimepiride 2 mg Tablet", "PRB", "tablet", "tablet", 1, 1_800, ("Amaryl", "Metrix", "Glimepiride 2"), (28, 90), 4, 0.08),
    Drug("KFA-PRB-005", "Candesartan 8 mg Tablet", "PRB", "tablet", "tablet", 1, 4_500, ("Blopress", "Decapres", "Candesartan 8mg"), (28, 90), 4, 0.08),
    Drug("KFA-PRB-006", "Clopidogrel 75 mg Tablet", "PRB", "tablet", "tablet", 1, 3_200, ("Plavix", "Cardogrel", "Clopidogrel 75"), (28, 90), 4, 0.08),
    Drug("KFA-ABX-001", "Ceftriaxone 1 g Injeksi", "Antibiotik", "vial", "vial", 1, 38_000, ("Ceftri 1g", "Ceftriaxone Inj", "Terfacef"), (4, 12), 4),
    Drug("KFA-ABX-002", "Meropenem 1 g Injeksi", "Antibiotik", "vial", "vial", 1, 310_000, ("Merofen", "Meropenem Inj", "Merem"), (6, 12), 3),
    Drug("KFA-ABX-003", "Levofloxacin 750 mg Infus 150 mL", "Antibiotik", "kolf", "kolf", 1, 185_000, ("Cravit Infus", "Leflox", "Levofloxacin Infus"), (2, 5), 3),
    Drug("KFA-INF-001", "Natrium Klorida 0,9% Infus 500 mL", "Infus", "kolf", "kolf", 1, 12_500, ("NaCl 0.9%", "Normal Saline", "Otsu-NS"), (3, 10), 4),
    Drug("KFA-INF-002", "Ringer Laktat Infus 500 mL", "Infus", "kolf", "kolf", 1, 13_500, ("RL Infus", "Ringer Lactate", "Otsu-RL"), (3, 10), 4),
    Drug("KFA-ALK-001", "Stent Koroner DES", "Alkes", "pcs", "pcs", 1, 9_500_000, ("Xience", "Resolute", "DES Sirolimus"), (1, 2), 1),
    Drug("KFA-ALK-002", "Benang Bedah Absorbable 2-0", "Alkes", "pcs", "pcs", 1, 85_000, ("Vicryl 2-0", "Safil 2-0", "Absorbable Suture 2-0"), (1, 6), 4),
    Drug("KFA-ALK-003", "IV Catheter 22G", "Alkes", "pcs", "pcs", 1, 14_000, ("Introcan", "Terumo IV Cath", "IV Cath 22G"), (1, 3), 4),
    Drug("KFA-ALK-004", "Mesh Hernia 15x15 cm", "Alkes", "pcs", "pcs", 1, 1_200_000, ("Prolene Mesh", "Parietex", "Hernia Mesh 15x15"), (1, 2), 2),
]
DRUG_BY_KFA: dict[str, Drug] = {d.kfa_code: d for d in DRUGS}


@dataclass(frozen=True)
class Facility:
    id: str
    name: str
    klass: str          # peer group
    rank: int           # 1 = Kelas A ... 4 = faskes kecil
    weight: float       # bobot volume layanan
    fraud_mult: float   # pengali kecenderungan injeksi fraud (sintetis)
    nostock: frozenset = frozenset()


FACILITIES: list[Facility] = [
    Facility("RS-A", "RS Sintetis A", "RS Kelas A", 1, 1.6, 0.6),
    Facility("RS-B", "RS Sintetis B", "RS Kelas A", 1, 1.4, 1.6),
    Facility("RS-C", "RS Sintetis C", "RS Kelas B", 2, 1.2, 0.8),
    Facility("RS-D", "RS Sintetis D", "RS Kelas B", 2, 1.1, 2.4, frozenset({"KFA-ALB-001"})),
    Facility("RS-E", "RS Sintetis E", "RS Kelas B", 2, 1.0, 0.7),
    Facility("RS-F", "RS Sintetis F", "RS Kelas C", 3, 0.9, 1.0),
    Facility("RS-G", "RS Sintetis G", "RS Kelas C", 3, 0.8, 1.9),
    Facility("RS-H", "RS Sintetis H", "RS Kelas C", 3, 0.8, 0.6),
    Facility("RS-I", "RS Sintetis I", "RS Kelas C", 3, 0.7, 0.9),
    Facility("RS-J", "Klinik Sintetis J", "Faskes Kecil", 4, 0.45, 1.2),
    Facility("RS-K", "Klinik Sintetis K", "Faskes Kecil", 4, 0.4, 0.8),
    Facility("RS-L", "Klinik Sintetis L", "Faskes Kecil", 4, 0.4, 2.0),
]
FAC_BY_ID: dict[str, Facility] = {f.id: f for f in FACILITIES}


def stocks(fac: Facility, drug: Drug) -> bool:
    """Apakah faskes ini memasok/menyimpan obat tersebut (desain data sintetis)."""
    return fac.rank <= drug.max_rank and drug.kfa_code not in fac.nostock


# Distribusi kategori acuan (desain generator) untuk uji Chi-Square di halaman Validasi Data.
# Ini BUKAN data publik/nasional; nilai diukur dari generator dan dipakai sebagai acuan konsistensi.
REFERENCE_CATEGORY_SHARE = {
    "Onkologi": 0.086, "Albumin": 0.040, "PRB": 0.497, "Antibiotik": 0.144, "Infus": 0.164, "Alkes": 0.070,
}

# ---------------------------------------------------------------- normalisasi nama obat
_clean = re.compile(r"[^a-z0-9%.,\s]+")


def norm_key(text: object) -> str:
    s = str(text).strip().lower().replace(",", ".")
    s = _clean.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def _build_alias_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for d in DRUGS:
        for alias in d.aliases:
            index[norm_key(alias)] = d.kfa_code
    # nama pendek unik, mis. "paclitaxel", "ringer"
    firsts: dict[str, set[str]] = {}
    for d in DRUGS:
        firsts.setdefault(norm_key(d.generic).split()[0], set()).add(d.kfa_code)
    for token, codes in firsts.items():
        if len(codes) == 1 and token not in index:
            index[token] = next(iter(codes))
    return index


ALIAS_INDEX = _build_alias_index()
_ALIAS_KEYS = list(ALIAS_INDEX)


def normalize_name(name: object) -> tuple[str | None, str]:
    """Kembalikan (kode_kfa, metode). metode: exact | fuzzy | unmapped."""
    key = norm_key(name)
    if key in ALIAS_INDEX:
        return ALIAS_INDEX[key], "exact"
    close = difflib.get_close_matches(key, _ALIAS_KEYS, n=1, cutoff=0.84)
    if close:
        return ALIAS_INDEX[close[0]], "fuzzy"
    return None, "unmapped"


def expected_units(drug: Drug, dose: float) -> int:
    """Satuan klaim yang wajar untuk dosis di RME. Pembulatan ke atas = susut/wastage wajar."""
    return max(1, math.ceil(round(dose / drug.pack_size, 6)))
