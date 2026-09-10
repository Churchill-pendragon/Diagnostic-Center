# Diagnostic Center Management System

This is the complete **local-source version** of the Diagnostic Center Management System. It uses:

- **HTML, CSS and vanilla JavaScript** for the interface.
- **PHP 8 + PDO** for staff authentication, permissions, patients, appointments, the test catalog, staff accounts and profiles.
- **Flask** for the laboratory worklist, result verification and PDF report generation.
- **MySQL** as the shared relational database.

Nothing in this folder needs to be hosted online. It is designed for XAMPP and VS Code on Windows.

## What works

- Secure staff login/logout with session cookies, hashed passwords and CSRF protection.
- Three roles: **Admin**, **Receptionist** and **Lab Technician**.
- Reception dashboard with live daily statistics and appointment schedule.
- Patient registration, search, editing and deletion.
- Appointment scheduling with one or multiple diagnostic tests.
- Appointment search, filters, rescheduling, status updates and deletion.
- Test catalog management, prices, specimens, units and reference ranges.
- Laboratory sample queue, “Begin Analysis” and verified result submission.
- Automatic appointment completion when all requested tests are ready.
- Searchable reports and proper downloadable PDF laboratory reports.
- Admin staff creation, role changes, deactivation and password reset.
- Staff profile editing and personal password changes.
- Audit logs for important actions.
- Responsive layout matching the supplied dark-blue diagnostic center reference.

## Architecture

```text
Browser (HTML/CSS/JavaScript)
        |
        | same-origin requests and PHP session
        v
PHP API -----> MySQL <----- Flask laboratory service
   |                              |
   +---- secure internal proxy ---+
                                  |
                                  +---- PDF reports
```

PHP protects the staff session and role permissions. The browser never receives the private Flask service key. PHP sends laboratory requests to Flask through `api/lab.php`, and both backends use the same MySQL records.

## Requirements

1. Windows 10 or 11.
2. [XAMPP](https://www.apachefriends.org/) with Apache, PHP 8 and MySQL.
3. Python 3.11 or newer.
4. VS Code.

## Step-by-step installation

### 1. Put the project in XAMPP

Extract/rename this folder to:

```text
C:\xampp\htdocs\diagnostic-center
```

Open that folder in VS Code.

### 2. Start Apache and MySQL

Open the XAMPP Control Panel and start:

- **Apache**
- **MySQL**

### 3. Create the database

For the normal XAMPP setup where the MySQL `root` account has no password, double-click:

```text
setup_database.bat
```

The script imports `database/schema.sql` and then runs `database/seed.php`.

If your MySQL account has a password instead:

1. Open `http://localhost/phpmyadmin`.
2. Select **Import**.
3. Import `database/schema.sql`.
4. Edit `config/config.php` with your MySQL username/password.
5. In the VS Code terminal run:

```powershell
C:\xampp\php\php.exe database\seed.php
```

### 4. Check the PHP configuration

Open `config/config.php` and make sure these values match MySQL:

```php
'host' => '127.0.0.1',
'name' => 'diagnostic_center',
'user' => 'root',
'password' => '',
```

The `service_key` under the `flask` section must exactly match `SERVICE_KEY` in the Flask `.env` file.

### 5. Install the Flask service

Open:

```text
flask-service\.env.example
```

The setup script copies it to `.env`. If MySQL has a password, edit `DB_PASSWORD` after the copy.

Double-click:

```text
flask-service\setup_flask.bat
```

This creates an isolated Python environment and installs Flask, the MySQL connector and ReportLab.

### 6. Run the system

Keep Apache and MySQL running in XAMPP. Then double-click:

```text
flask-service\run_flask.bat
```

Keep that terminal window open. Now visit:

```text
http://localhost/diagnostic-center/
```

You can also use `run_local.bat` after the first setup; it starts Flask and opens the browser automatically.

## Demo accounts

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `Admin@123` |
| Receptionist | `reception` | `Reception@123` |
| Lab Technician | `labtech` | `Lab@123` |

Change these passwords from **Profile** before using real records.

## Role permissions

| Feature | Admin | Receptionist | Lab Technician |
|---|:---:|:---:|:---:|
| Dashboard | ✓ | ✓ | ✓ |
| Patients | Full | Full | — |
| Appointments | Full | Create/edit | — |
| Test catalog | Full | View | View |
| Laboratory worklist | Full | — | Full |
| Reports/PDF | View | View | View |
| Staff accounts | Full | — | — |
| Own profile/password | ✓ | ✓ | ✓ |

## Demonstration flow

1. Sign in as `reception`.
2. Open **Patients** and register a new patient.
3. Open **Appointments**, select the patient and choose one or more tests.
4. Log out and sign in as `labtech`.
5. Open **Laboratory**, click **Begin Analysis**, then **Enter Findings**.
6. Open **Reports** and download the generated PDF.
7. Sign in as `admin` to manage the test catalog and staff accounts.

## Troubleshooting

### “Database connection failed”

- Confirm MySQL is running in XAMPP.
- Confirm `config/config.php` and `flask-service/.env` use the same database settings.
- Import `database/schema.sql`, then run `database/seed.php`.

### “Flask laboratory service is offline”

- Run `flask-service/setup_flask.bat` once.
- Run `flask-service/run_flask.bat` and keep it open.
- Confirm Flask says it is running on `http://127.0.0.1:5001`.

### “PHP cURL is disabled”

1. Open `C:\xampp\php\php.ini`.
2. Find `;extension=curl`.
3. Remove the semicolon so it becomes `extension=curl`.
4. Restart Apache.

### Login does not work

Run the seed command again:

```powershell
C:\xampp\php\php.exe database\seed.php
```

The seed is repeatable and recreates the demo account passwords.

## Before using real patient information

- Set `debug` to `false` in `config/config.php`.
- Change every demo password.
- Replace `change-this-service-key` with the same long random value in both configuration files.
- Keep the system on a trusted local computer/network.
- Back up the `diagnostic_center` MySQL database regularly.
- Do not use the app as a substitute for professional clinical interpretation or regulatory validation.

