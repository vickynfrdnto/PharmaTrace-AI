@echo off
REM === PharmaTrace-AI: jalur TANPA Docker (venv + npm). Butuh Python 3.11 dan Node.js 20+ ===
cd /d %~dp0
if not exist .env copy .env.example .env >nul

if not exist backend\.venv (
  echo [1/4] Membuat virtual environment...
  py -3.11 -m venv backend\.venv || python -m venv backend\.venv
)
echo [2/4] Memasang dependency backend (versi dipin)...
backend\.venv\Scripts\python -m pip install --quiet --upgrade pip
backend\.venv\Scripts\python -m pip install --quiet -r backend\requirements.txt

if not exist frontend\node_modules (
  echo [3/4] Memasang dependency frontend...
  pushd frontend
  call npm install --no-audit --no-fund
  popd
)
echo [4/4] Menjalankan backend (port 8001) dan frontend (port 5173)...
start "PharmaTrace Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8001"
start "PharmaTrace Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 6 >nul
start http://localhost:5173
