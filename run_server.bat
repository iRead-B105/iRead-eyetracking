@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Missing .venv. Run setup_venv.bat first.
  exit /b 1
)

".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8765
