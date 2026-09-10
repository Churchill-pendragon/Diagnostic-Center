CREATE DATABASE IF NOT EXISTS diagnostic_center
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE diagnostic_center;

CREATE TABLE IF NOT EXISTS staff (
  staff_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  username VARCHAR(60) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('Admin', 'Receptionist', 'Lab Technician') NOT NULL,
  email VARCHAR(120) NULL,
  phone VARCHAR(20) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_staff_role_active (role, active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patients (
  patient_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_no VARCHAR(30) NOT NULL UNIQUE,
  first_name VARCHAR(60) NOT NULL,
  last_name VARCHAR(60) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender ENUM('M', 'F', 'Other') NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(120) NULL,
  address VARCHAR(255) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_patients_creator FOREIGN KEY (created_by) REFERENCES staff(staff_id),
  INDEX idx_patients_name (last_name, first_name),
  INDEX idx_patients_phone (phone)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS test_catalog (
  test_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  test_code VARCHAR(20) NOT NULL UNIQUE,
  test_name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL,
  specimen VARCHAR(80) NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  normal_range VARCHAR(160) NOT NULL,
  unit VARCHAR(40) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_test_catalog_active_name (active, test_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointments (
  appointment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_no VARCHAR(30) NOT NULL UNIQUE,
  patient_id BIGINT UNSIGNED NOT NULL,
  appointment_date DATETIME NOT NULL,
  status ENUM('Scheduled', 'In Progress', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Scheduled',
  notes TEXT NULL,
  booked_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_appointments_patient FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
  CONSTRAINT fk_appointments_staff FOREIGN KEY (booked_by) REFERENCES staff(staff_id),
  INDEX idx_appointments_date_status (appointment_date, status),
  INDEX idx_appointments_patient (patient_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS test_results (
  result_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  test_id INT UNSIGNED NOT NULL,
  status ENUM('Sample Collected', 'Analyzing', 'Report Ready') NOT NULL DEFAULT 'Sample Collected',
  result_value TEXT NULL,
  result_notes TEXT NULL,
  sample_collected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  verified_by INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_results_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id) ON DELETE CASCADE,
  CONSTRAINT fk_results_test FOREIGN KEY (test_id) REFERENCES test_catalog(test_id),
  CONSTRAINT fk_results_verifier FOREIGN KEY (verified_by) REFERENCES staff(staff_id),
  UNIQUE KEY uq_appointment_test (appointment_id, test_id),
  INDEX idx_results_status (status),
  INDEX idx_results_completed (completed_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  staff_id INT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(50) NULL,
  entity_id VARCHAR(50) NULL,
  details JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_staff FOREIGN KEY (staff_id) REFERENCES staff(staff_id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB;

