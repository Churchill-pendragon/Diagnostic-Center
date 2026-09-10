import os
import sys
from pathlib import Path

os.environ.setdefault("SERVICE_KEY", "test-service-key")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as lab_service  # noqa: E402

app = lab_service.app


def test_health_is_available():
    client = app.test_client()
    response = client.get("/health")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_worklist_rejects_missing_service_key_before_database_access():
    client = app.test_client()
    response = client.get("/worklist")
    assert response.status_code == 401
    assert "service key" in response.get_json()["error"].lower()


def test_worklist_rejects_wrong_service_key_before_database_access():
    client = app.test_client()
    response = client.get("/worklist", headers={"X-Service-Key": "wrong"})
    assert response.status_code == 401


def test_pdf_report_is_generated(monkeypatch):
    monkeypatch.setattr(
        lab_service,
        "report_record",
        lambda result_id: {
            "result_id": result_id,
            "result_value": "5.8 ×10³/µL",
            "result_notes": "Within the supplied reference range.",
            "completed_at": "2026-08-26 14:35:00",
            "appointment_no": "APT-TEST-001",
            "appointment_date": "2026-08-26 13:30:00",
            "patient_no": "PAT-TEST-001",
            "first_name": "Kofi",
            "last_name": "Owusu",
            "date_of_birth": "1998-04-11",
            "gender": "M",
            "phone": "0241234567",
            "test_code": "CBC",
            "test_name": "Complete Blood Count (CBC)",
            "normal_range": "4.5 – 11.0",
            "unit": "×10³/µL",
            "verified_by": "Dr. Sena Asare",
        },
    )
    client = app.test_client()
    response = client.get(
        "/reports/1/pdf",
        headers={"X-Service-Key": "test-service-key"},
    )
    assert response.status_code == 200
    assert response.mimetype == "application/pdf"
    assert response.data.startswith(b"%PDF")
