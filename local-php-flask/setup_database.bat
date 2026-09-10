@echo off
setlocal
cd /d "%~dp0"

set "MYSQL_EXE=C:\xampp\mysql\bin\mysql.exe"
set "PHP_EXE=C:\xampp\php\php.exe"

if not exist "%MYSQL_EXE%" (
  echo XAMPP MySQL was not found at %MYSQL_EXE%
  echo Install XAMPP or edit setup_database.bat with the correct path.
  pause
  exit /b 1
)

if not exist "%PHP_EXE%" (
  echo XAMPP PHP was not found at %PHP_EXE%
  pause
  exit /b 1
)

echo Creating the diagnostic_center database...
"%MYSQL_EXE%" -u root < database\schema.sql
if errorlevel 1 (
  echo Database import failed. If MySQL has a password, use phpMyAdmin to import database\schema.sql.
  pause
  exit /b 1
)

echo Adding test catalog and demo accounts...
"%PHP_EXE%" database\seed.php
if errorlevel 1 (
  echo Seed failed. Check config\config.php and make sure MySQL is running.
  pause
  exit /b 1
)

echo.
echo Database setup completed.
pause

