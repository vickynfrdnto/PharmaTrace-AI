@echo off
REM === PharmaTrace-AI: SATU perintah (Docker) ===
cd /d %~dp0
if not exist .env (
  copy .env.example .env >nul
  echo File .env dibuat dari .env.example. Ganti HMAC_SECRET sebelum dipakai di luar demo.
)
docker compose up --build
REM Buka http://localhost:5173
