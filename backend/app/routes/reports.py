from flask import Blueprint, current_app, jsonify, request
from postgrest.exceptions import APIError
from app.services.supabase_service import get_supabase

reports_bp = Blueprint("reports", __name__)

ILLNESSES = (
    "Common cold",
    "COVID-19",
    "Flu",
    "Strep throat",
    "Mononucleosis (mono)",
    "Norovirus",
    "Stomach bug",
    "RSV",
    "Pink eye (conjunctivitis)",
    "Sinus infection",
    "Other",
)


@reports_bp.get("")
def get_reports():
    supabase = get_supabase()

    response = (
        supabase
        .table("reports")
        .select("id,location_id,severity,created_at")
        .order("created_at", desc=True)
        .execute()
    )

    return jsonify(response.data)


@reports_bp.post("")
def create_report():
    data = request.get_json(silent=True)

    if not isinstance(data, dict) or not data:
        return jsonify({
            "error": "Request body is required"
        }), 400

    location_id = data.get("location_id")
    severity = data.get("severity")

    address = data.get("address")
    illness = data.get("illness")

    for name, value, limit in (("address", address, 500), ("illness", illness, 200)):
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
            return jsonify({"error": f"{name} must contain 1–{limit} characters"}), 400

    if illness.strip() not in ILLNESSES:
        return jsonify({"error": "Select an illness from the provided list"}), 400

    flu_type = data.get("flu_type")
    if flu_type is not None:
        if illness.strip() != "Flu" or flu_type not in ("A", "B"):
            return jsonify({"error": "Flu type must be A or B and can only be selected for Flu"}), 400

    if type(severity) is not int or not 1 <= severity <= 5:
        return jsonify({"error": "severity must be an integer between 1 and 5"}), 400

    if location_id is not None and (type(location_id) is not int or location_id < 1):
        return jsonify({"error": "location_id must be a positive integer"}), 400

    report = {
        "location_id": location_id,
        "severity": severity,
        "address": address.strip(),
        "illness": f"Flu {flu_type}" if flu_type is not None else illness.strip(),
    }

    try:
        response = get_supabase().table("reports").insert(report).execute()
    except APIError as error:
        if error.code == "23503":
            return jsonify({"error": "The selected location does not exist"}), 400
        current_app.logger.error("Report insert failed (%s)", error.code)
        return jsonify({"error": "Unable to save your report. Please try again later."}), 503
    except Exception:
        current_app.logger.error("Report storage is unavailable")
        return jsonify({"error": "Unable to save your report. Please try again later."}), 503

    if not response.data:
        return jsonify({"error": "The report could not be confirmed as saved."}), 503

    # Do not echo addresses or illness descriptions through public API responses.
    return jsonify([
        {key: row[key] for key in ("id", "location_id", "severity", "created_at")}
        for row in response.data
    ]), 201
