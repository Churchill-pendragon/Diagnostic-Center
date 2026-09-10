from __future__ import annotations

import hmac
import io
import os
from datetime import datetime
from functools import wraps
from typing import Any, Callable, TypeVar
from xml.sax.saxutils import escape

import mysql.connector
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_file
from mysql.connector import Error as MySQLError
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

load_dotenv()

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

F = TypeVar("F", bound=Callable[..., Any])


def database_config() -> dict[str, Any]:
    return {
        "host": os.getenv("DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "database": os.getenv("DB_NAME", "diagnostic_center"),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", ""),
        "charset": "utf8mb4",
        "collation": "utf8mb4_unicode_ci",
    }


def get_connection():
    return mysql.connector.connect(**database_config())


def service_key_required(function: F) -> F:
    @wraps(function)
    def wrapped(*args: Any, **kwargs: Any):
        expected = os.getenv("SERVICE_KEY", "change-this-service-key")
        supplied = request.headers.get("X-Service-Key", "")
        if not supplied or not hmac.compare_digest(supplied, expected):
            return jsonify(error="Invalid laboratory service key."), 401
        return function(*args, **kwargs)

    return wrapped  # type: ignore[return-value]


def verify_lab_staff(cursor, staff_id: int) -> bool:
    cursor.execute(
        "SELECT staff_id FROM staff WHERE staff_id = %s AND active = 1 "
        "AND role IN ('Admin', 'Lab Technician')",
        (staff_id,),
    )
    return cursor.fetchone() is not None


@app.errorhandler(MySQLError)
def handle_database_error(error: MySQLError):
    app.logger.exception("Database request failed")
    message = str(error) if app.debug else "The laboratory database request failed."
    return jsonify(error=message), 500


@app.errorhandler(Exception)
def handle_unexpected_error(error: Exception):
    app.logger.exception("Unexpected laboratory service error")
    message = str(error) if app.debug else "The laboratory service could not complete the request."
    return jsonify(error=message), 500


@app.get("/health")
def health():
    return jsonify(service="MediDiag laboratory service", status="ok", time=datetime.now().isoformat())


@app.get("/worklist")
@service_key_required
def worklist():
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT tr.result_id, tr.status, tr.sample_collected_at, tr.updated_at,
                   a.appointment_id, a.appointment_no, a.appointment_date,
                   p.patient_id, p.patient_no, p.first_name, p.last_name,
                   p.date_of_birth, p.gender, p.phone,
                   tc.test_id, tc.test_code, tc.test_name, tc.category,
                   tc.specimen, tc.normal_range, tc.unit
            FROM test_results tr
            JOIN appointments a ON a.appointment_id = tr.appointment_id
            JOIN patients p ON p.patient_id = a.patient_id
            JOIN test_catalog tc ON tc.test_id = tr.test_id
            WHERE tr.status IN ('Sample Collected', 'Analyzing')
              AND a.status != 'Cancelled'
            ORDER BY CASE tr.status WHEN 'Analyzing' THEN 0 ELSE 1 END,
                     tr.sample_collected_at ASC
            """
        )
        rows = cursor.fetchall()
        for row in rows:
            for key in ("sample_collected_at", "updated_at", "appointment_date", "date_of_birth"):
                if row.get(key) is not None:
                    row[key] = row[key].isoformat()
        stats = {
            "samples_collected": sum(row["status"] == "Sample Collected" for row in rows),
            "analyzing": sum(row["status"] == "Analyzing" for row in rows),
            "pending": len(rows),
        }
        return jsonify(data=rows, stats=stats)
    finally:
        cursor.close()
        connection.close()


@app.post("/results/<int:result_id>/start")
@service_key_required
def start_result(result_id: int):
    payload = request.get_json(silent=True) or {}
    staff_id = int(payload.get("staff_id") or 0)
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        connection.start_transaction()
        if not verify_lab_staff(cursor, staff_id):
            connection.rollback()
            return jsonify(error="The laboratory staff account is invalid."), 403
        cursor.execute(
            "SELECT appointment_id, status FROM test_results WHERE result_id = %s FOR UPDATE",
            (result_id,),
        )
        result = cursor.fetchone()
        if not result:
            connection.rollback()
            return jsonify(error="Laboratory result not found."), 404
        if result["status"] == "Report Ready":
            connection.rollback()
            return jsonify(error="This report has already been completed."), 409
        cursor.execute(
            "UPDATE test_results SET status = 'Analyzing' WHERE result_id = %s",
            (result_id,),
        )
        cursor.execute(
            "UPDATE appointments SET status = 'In Progress' WHERE appointment_id = %s",
            (result["appointment_id"],),
        )
        connection.commit()
        return jsonify(success=True, status="Analyzing")
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


@app.post("/results/<int:result_id>/complete")
@service_key_required
def complete_result(result_id: int):
    payload = request.get_json(silent=True) or {}
    staff_id = int(payload.get("staff_id") or 0)
    result_value = str(payload.get("result_value") or "").strip()
    result_notes = str(payload.get("result_notes") or "").strip()
    if not result_value:
        return jsonify(error="The laboratory result value is required."), 422

    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        connection.start_transaction()
        if not verify_lab_staff(cursor, staff_id):
            connection.rollback()
            return jsonify(error="The laboratory staff account is invalid."), 403
        cursor.execute(
            "SELECT appointment_id, status FROM test_results WHERE result_id = %s FOR UPDATE",
            (result_id,),
        )
        result = cursor.fetchone()
        if not result:
            connection.rollback()
            return jsonify(error="Laboratory result not found."), 404
        if result["status"] == "Report Ready":
            connection.rollback()
            return jsonify(error="This report has already been completed."), 409

        cursor.execute(
            """
            UPDATE test_results
            SET status = 'Report Ready', result_value = %s, result_notes = %s,
                verified_by = %s, completed_at = NOW()
            WHERE result_id = %s
            """,
            (result_value, result_notes or None, staff_id, result_id),
        )
        cursor.execute(
            "SELECT COUNT(*) AS pending FROM test_results "
            "WHERE appointment_id = %s AND status != 'Report Ready'",
            (result["appointment_id"],),
        )
        pending = int(cursor.fetchone()["pending"])
        appointment_status = "Completed" if pending == 0 else "In Progress"
        cursor.execute(
            "UPDATE appointments SET status = %s WHERE appointment_id = %s",
            (appointment_status, result["appointment_id"]),
        )
        connection.commit()
        return jsonify(success=True, status="Report Ready", appointment_status=appointment_status)
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


def report_record(result_id: int) -> dict[str, Any] | None:
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT tr.result_id, tr.result_value, tr.result_notes, tr.completed_at,
                   a.appointment_no, a.appointment_date,
                   p.patient_no, p.first_name, p.last_name, p.date_of_birth,
                   p.gender, p.phone,
                   tc.test_code, tc.test_name, tc.normal_range, tc.unit,
                   s.full_name AS verified_by
            FROM test_results tr
            JOIN appointments a ON a.appointment_id = tr.appointment_id
            JOIN patients p ON p.patient_id = a.patient_id
            JOIN test_catalog tc ON tc.test_id = tr.test_id
            LEFT JOIN staff s ON s.staff_id = tr.verified_by
            WHERE tr.result_id = %s AND tr.status = 'Report Ready'
            """,
            (result_id,),
        )
        return cursor.fetchone()
    finally:
        cursor.close()
        connection.close()


@app.get("/reports/<int:result_id>/pdf")
@service_key_required
def report_pdf(result_id: int):
    record = report_record(result_id)
    if not record:
        return jsonify(error="Completed report not found."), 404

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"MediDiag Report {result_id}",
        author=os.getenv("CENTER_NAME", "MediDiag Diagnostic Center"),
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="CenterTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=colors.HexColor("#082f49"), alignment=TA_LEFT))
    styles.add(ParagraphStyle(name="SmallRight", parent=styles["Normal"], fontSize=8, leading=11, textColor=colors.HexColor("#64748b"), alignment=TA_RIGHT))
    styles.add(ParagraphStyle(name="Label", parent=styles["Normal"], fontSize=8, leading=10, textColor=colors.HexColor("#64748b"), spaceAfter=3))
    styles.add(ParagraphStyle(name="Value", parent=styles["Normal"], fontSize=10, leading=14, textColor=colors.HexColor("#0f172a")))
    styles.add(ParagraphStyle(name="Result", parent=styles["Normal"], fontSize=12, leading=18, textColor=colors.HexColor("#0f172a")))
    styles.add(ParagraphStyle(name="Footer", parent=styles["Normal"], fontSize=7, leading=10, textColor=colors.HexColor("#64748b"), alignment=TA_CENTER))

    center_name = escape(os.getenv("CENTER_NAME", "MediDiag Diagnostic Center"))
    center_details = "<br/>".join(
        escape(value)
        for value in [os.getenv("CENTER_ADDRESS", "Kumasi, Ghana"), os.getenv("CENTER_PHONE", "")]
        if value
    )
    story: list[Any] = []
    header = Table(
        [[Paragraph(center_name, styles["CenterTitle"]), Paragraph(center_details, styles["SmallRight"])]],
        colWidths=[112 * mm, 48 * mm],
    )
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 2, colors.HexColor("#0891b2")), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    story.extend([header, Spacer(1, 7 * mm), Paragraph("LABORATORY RESULT REPORT", ParagraphStyle(name="ReportHeading", parent=styles["Heading2"], fontSize=12, textColor=colors.HexColor("#0e7490"), alignment=TA_CENTER, spaceAfter=12))])

    patient_name = f"{record['first_name']} {record['last_name']}"
    patient_data = [
        [Paragraph("PATIENT", styles["Label"]), Paragraph("PATIENT NUMBER", styles["Label"]), Paragraph("REPORT ID", styles["Label"])],
        [Paragraph(escape(patient_name), styles["Value"]), Paragraph(escape(str(record["patient_no"])), styles["Value"]), Paragraph(f"RES-{record['result_id']}", styles["Value"])],
        [Paragraph("DATE OF BIRTH", styles["Label"]), Paragraph("GENDER", styles["Label"]), Paragraph("COMPLETED", styles["Label"])],
        [Paragraph(str(record["date_of_birth"]), styles["Value"]), Paragraph(escape(str(record["gender"])), styles["Value"]), Paragraph(str(record["completed_at"]), styles["Value"])],
    ]
    patient_table = Table(patient_data, colWidths=[65 * mm, 48 * mm, 47 * mm])
    patient_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")), ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")), ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.extend([patient_table, Spacer(1, 7 * mm)])

    unit = f" {record['unit']}" if record.get("unit") else ""
    result_data = [
        [Paragraph("TEST", styles["Label"]), Paragraph("REFERENCE RANGE", styles["Label"])],
        [Paragraph(escape(record["test_name"]), styles["Value"]), Paragraph(escape(f"{record['normal_range']}{unit}"), styles["Value"])],
        [Paragraph("VERIFIED FINDINGS", styles["Label"]), ""],
        [Paragraph(escape(record["result_value"]).replace("\n", "<br/>"), styles["Result"]), ""],
    ]
    result_table = Table(result_data, colWidths=[80 * mm, 80 * mm])
    result_table.setStyle(TableStyle([("SPAN", (0, 2), (1, 2)), ("SPAN", (0, 3), (1, 3)), ("BACKGROUND", (0, 0), (-1, 1), colors.HexColor("#ecfeff")), ("BACKGROUND", (0, 2), (-1, 3), colors.white), ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#a5f3fc")), ("INNERGRID", (0, 0), (-1, 1), 0.25, colors.HexColor("#bae6fd")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story.extend([result_table, Spacer(1, 6 * mm)])

    if record.get("result_notes"):
        story.extend([Paragraph("TECHNICIAN NOTES", styles["Label"]), Paragraph(escape(record["result_notes"]).replace("\n", "<br/>"), styles["Value"]), Spacer(1, 8 * mm)])
    story.extend([
        Paragraph("VERIFIED BY", styles["Label"]),
        Paragraph(escape(record.get("verified_by") or "Laboratory Technician"), styles["Value"]),
        Spacer(1, 15 * mm),
        Paragraph("This computer-generated report was verified within the MediDiag system. Clinical interpretation must be performed by a qualified healthcare professional.", styles["Footer"]),
    ])

    document.build(story)
    buffer.seek(0)
    return send_file(buffer, mimetype="application/pdf", as_attachment=True, download_name=f"MediDiag-Report-{result_id}.pdf")


if __name__ == "__main__":
    app.run(
        host=os.getenv("FLASK_HOST", "127.0.0.1"),
        port=int(os.getenv("FLASK_PORT", "5001")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )

