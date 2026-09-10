@echo off
setlocal
cd /d "%~dp0"

start "MediDiag Flask Service" cmd /k "cd /d "%~dp0flask-service" && run_flask.bat"
timeout /t 2 /nobreak >nul
start "" "http://localhost/diagnostic-center/"

echo MediDiag opened. Keep the Flask service window running.
echo Apache and MySQL must also be running in XAMPP.
pause

