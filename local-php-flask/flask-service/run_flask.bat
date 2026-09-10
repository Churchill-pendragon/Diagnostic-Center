@echo off
setlocal
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo Run setup_flask.bat first.
    pause
    exit /b 1
)

if not exist .env copy .env.example .env >nul
.venv\Scripts\python.exe app.py

