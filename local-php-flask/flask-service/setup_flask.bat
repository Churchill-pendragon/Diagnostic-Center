@echo off
setlocal
cd /d "%~dp0"

if not exist .env copy .env.example .env >nul
if not exist .venv (
    py -3 -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo.
echo Flask laboratory service setup completed.
echo Edit flask-service\.env if your MySQL password or service key is different.
pause

