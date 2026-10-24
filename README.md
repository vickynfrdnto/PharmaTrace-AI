# PharmaTrace AI — .id DeveloperDay 2026 Submission

**A human-led medicine and medical-device claims audit prototype.** PharmaTrace AI reconciles procurement, FHIR-like medical-record activity, and submitted claims to surface explainable discrepancies for review before payment.

The project is prepared for **.id DeveloperDay 2026**, category **Inclusions & Community Services - Health & Wellbeing**. It is a functional prototype / early MVP, not a production claims adjudication system.

> **Synthetic data only.** The bundled demonstration contains no real JKN member or patient records. Scores and impact estimates are not validated on operational data. AI prioritizes review; an authorized human makes every final decision. Never upload real patient data to this demo.

Submission materials: [`submission/READY-TO-SUBMIT.md`](submission/READY-TO-SUBMIT.md), [`submission/TEAM-PROFILE.md`](submission/TEAM-PROFILE.md), [`submission/VIDEO-SCRIPT-ID.md`](submission/VIDEO-SCRIPT-ID.md), and [`output/pdf/PharmaTrace_AI_DeveloperDay_2026.pdf`](output/pdf/PharmaTrace_AI_DeveloperDay_2026.pdf).

## 1. Menjalankan di Windows

**A. Satu perintah (Docker Desktop)**
```
start.bat
```
Buka http://localhost:5173 (pertama kali butuh internet untuk build image; setelah itu demo bisa offline).

**B. Tanpa Docker (Python 3.11 + Node.js 20+)**
```
start-local.bat
```
Skrip membuat venv, memasang dependency ber-versi-pin, lalu membuka backend (:8001) dan frontend (:5173).

Manual: `cd backend && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt && .venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8001`, lalu di terminal lain `cd frontend && npm install && npm run dev`.

Start pertama backend butuh ±10–20 detik (memuat SHAP/numba); tunggu jendela backend menampilkan "Application startup complete" sebelum membuka browser. Tidak butuh GPU, API key, maupun internet saat demo. **Ganti `HMAC_SECRET` dan `TOKEN_SECRET` di `.env`** (disalin otomatis dari `.env.example`).

Tes: `run-tests.bat` (suite pytest backend; mencakup tes parser, privasi, akses per peran, API, dan alur audit).

Akun demo (tombol di layar login): `supervisor1/supervisor123`, `verifikator1/verifikator123` (hanya faskes RS-B, D, G, L), `admin1/admin123`.

## 2. Struktur folder
```
backend/app/
  master.py     Kamus KFA mini (23 obat/alkes + variasi merek), master faskes, normalisasi nama (exact + fuzzy)
  generator.py  Generator 3 pintu + injeksi 4 skenario fraud berlabel + "jebakan jujur" + kasus unggulan CLM-DEMO-xx
  ingest.py     Parsing, validasi, flatten FHIR-like, PSEUDONIMISASI sebelum analitik
  privacy.py    HMAC-SHA-256 (kunci dari env)
  engine.py     Admission Synchronizer, Posology Cross-Matcher, Package Guard, neraca stok + masa tenggang,
                IsolationForest, SHAP, Discrepancy Index (bobot terdokumentasi di docstring), heatmap, evaluasi, uji Chi-Square
  explain.py    Kartu penjelasan berbahasa Indonesia
  jobs.py       Job audit latar belakang dengan progres & waktu per tahap yang NYATA
  security.py   Token HMAC, RBAC 3 peran, audit trail berantai-hash
  workflow.py   Mesin status keputusan (Tolak / Klarifikasi / Pengecualian / RS Menyanggah / putusan Supervisor)
  db.py main.py SQLite (SQLAlchemy) dan API FastAPI
backend/tests/  pytest: generator, neraca stok, grace period, pseudonimisasi, API, e2e upload→audit→keputusan
frontend/src/   React+Vite+TS+Tailwind; pages/ (9 halaman), components/Scene3D.tsx (React Three Fiber, instancing)
```

## 3. Alur demo 3 menit
1. **0:00** Login Supervisor → Beranda: jelaskan visual 3D (Tiga Pintu → Engine → Keputusan). Partikel merah = rasio flag nyata run terakhir.
2. **0:30** Klik **Muat Skenario Demo** → progres per tahap dengan waktu terukur (±4–5 dtk untuk 3×10.000 record).
3. **1:00** **Heatmap**: sel merah >20% (slider ambang) → klik sel RS-D × Albumin → klaim ter-flag.
4. **1:30** **Claim Inspector** → kasus unggulan **01**: klaim 5 vial, e-Katalog 0, RME 1 vial, Rp 14,5 jt; kartu penjelasan + SHAP. Tulis catatan → **Tolak Klaim** → **RS Menyanggah** → login ulang sebagai Supervisor → **Sanggahan Diterima**. (Kasus 02–06: phantom Trastuzumab, gelembung Paclitaxel, resep tanpa kunjungan, penagihan ganda paket/PRB, refill berulang.)
5. **2:15** **Evaluasi Model**: naif vs rule-only vs hibrida, PR-curve, recall per skenario (kelemahan tampil jujur), tombol CSV/PNG.
6. **2:40** **Kalkulator Dampak** (recall diambil dari evaluasi nyata, label "Estimasi, bukan hasil terukur") dan **Privasi** (demo HMAC + verifikasi rantai audit trail).

## 4. Hasil aktual (3×10.000 record, seed 20261011, data sintetis)
| Metode | Precision | Recall | F1 | FPR |
|---|---|---|---|---|
| Naif (klaim > RME) | 63,2% | 65,4% | 64,3% | 6,7% |
| Rule-only | 95,0% | 88,0% | 91,3% | 0,8% |
| Hibrida (rule + IsolationForest) | 88,0% | 90,1% | 89,0% | 2,2% |

Waktu proses audit ±4,4 dtk (pseudonimisasi + analitik; pembangkitan data ±2 dtk dan simpan DB ±0,9 dtk dilaporkan terpisah). Angka dihitung ulang setiap run; mungkin berbeda tipis antar mesin.
Recall 90,1% **di bawah target 92%** pada slide proposal — angka proposal sebaiknya diganti hasil ini. Varian "collusive" (RME ikut digelembungkan) hanya 21% tertangkap dan "subtle" (dalam toleransi tablet) 0%: batas yang memang ditampilkan di UI.

## 4b. Deploy frontend dan API secara terpisah

Frontend dapat dibangun sebagai situs statis. Untuk hosting frontend dan FastAPI pada origin berbeda:

1. Saat membangun frontend, set `VITE_API_BASE_URL` ke origin API, misalnya `https://api.pharmatrace.my.id` (tanpa akhiran `/api`).
2. Pada backend, set `CORS_ORIGINS=https://app.pharmatrace.my.id` (tambahkan origin lain dipisah koma bila diperlukan).
3. Set `HMAC_SECRET` dan `TOKEN_SECRET` ke nilai acak yang panjang pada pengaturan environment host. Jangan menggunakan `.env.example` sebagai nilai produksi.
4. Hubungkan `app.pharmatrace.my.id` ke frontend dan `api.pharmatrace.my.id` ke FastAPI. Pastikan HTTPS aktif.

Firebase Hosting pada paket Spark dapat melayani frontend React statis dan domain kustom, tetapi tidak menjalankan API FastAPI. Firebase Cloud Functions / App Hosting memerlukan billing account. Layanan backend gratis juga dapat tidur atau menghapus filesystem; file SQLite pada layanan seperti Render Free tidak persisten. Untuk demo hosted, uji API dan akun demo pada URL publik lebih dahulu, siapkan aplikasi sebelum sesi juri, dan gunakan data sintetis saja. Detail operasional ada di [`submission/READY-TO-SUBMIT.md`](submission/READY-TO-SUBMIT.md).

Konfigurasi Firebase Hosting untuk React SPA tersedia di `firebase.json` (hasil build: `frontend/dist`). Tetapkan `VITE_API_BASE_URL` sebelum build; bila kosong, aplikasi mencari API pada domain Firebase dan login/audit tidak akan berfungsi. Untuk backend, `APP_ENV=production` memaksa secret HMAC/token yang kuat dan berbeda, serta daftar CORS eksplisit. Hosting publik ini tetap demo: akun demo diketahui publik, job berjalan dalam memori, dan SQLite memerlukan penyimpanan persisten. Jangan masukkan data nyata.

## 4c. Status pemeriksaan
Build frontend dan pemeriksaan sintaks backend dijalankan saat finalisasi. Deployment Firebase/API publik, DNS domain, sesi browser pada host, dan perekaman demo perlu dilakukan pada akun pemilik proyek. Pemeriksaan lokal tidak menggantikan uji integrasi pada host maupun integrasi dengan sistem layanan kesehatan.

## 5. Keterbatasan jujur
- Data sintetis; belum diuji di SIMRS/VEDIKA/e-Katalog riil. Metrik pada data riil bisa sangat berbeda.
- Asumsi desain: stok JKN dapat dipisahkan (depo/alokasi JKN); kode "KFA" di master hanya fiktif; harga sintetis.
- Evaluasi retrospektif: masa tenggang 14 hari dianggap sudah lewat untuk semua klaim. Mode produksi (`as_of`) tersedia di engine tetapi belum dipasang ke UI.
- ML menambah recall dengan harga salah-tandai tambahan (lihat trade-off ambang DI di Evaluasi); ambang default 20 ditentukan sebagai anggaran review (~2%), bukan dituning terhadap label.
- Uji Chi-Square memakai acuan desain generator, bukan distribusi nasional; pada n=10.000 uji sangat sensitif (lihat ukuran efek w).
- Autentikasi demo (akun tetap); bukan SSO/produksi. Kunci HMAC bawaan hanya untuk demo.
- Belum terverifikasi dalam pengembangan ini: tampilan di browser sungguhan & FPS 3D (target ≥45 FPS belum diukur di mesin target), build Docker, skrip .bat di Windows, dan Python 3.11 (diuji di 3.12). Panel FPS di Beranda mengukur FPS aktual di mesin Anda.
