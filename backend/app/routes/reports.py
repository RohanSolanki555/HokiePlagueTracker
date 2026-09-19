from flask import Blueprint, jsonify, request
from app.services.supabase_service import get_supabase

reports_bp = Blueprint("reports", __name__)


@reports_bp.get("")
def get_reports():
    supabase = get_supabase()

    response = (
        supabase
        .table("reports")
        .select("*")
        .order("created_at", desc=True)
        .execute()
    )

    return jsonify(response.data)


@reports_bp.post("")
def create_report():
    data = request.get_json()

    if not data:
        return jsonify({
            "error": "Request body is required"
        }), 400

    location_id = data.get("location_id")
    severity = data.get("severity")

    if location_id is None or severity is None:
        return jsonify({
            "error": "location_id and severity are required"
        }), 400

    report = {
        "location_id": location_id,
        "severity": severity
    }

    supabase = get_supabase()

    response = (
        supabase
        .table("reports")
        .insert(report)
        .execute()
    )

    return jsonify(response.data), 201