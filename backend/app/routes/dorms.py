from flask import Blueprint, current_app, jsonify, request

from app.services.dorm_service import get_dorm_detail, list_dorms
from app.services.supabase_service import get_supabase
from app.services.report_period import parse_days

dorms_bp = Blueprint("dorms", __name__)


@dorms_bp.get("")
def get_dorms():
    try:
        days = parse_days(request.args.get("days", "7"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    try:
        return jsonify(list_dorms(get_supabase(), days))
    except Exception:
        current_app.logger.exception("Unable to load dorm statistics")
        return jsonify({"error": "Dorm data is unavailable. Please try again."}), 503


@dorms_bp.get("/<int:dorm_id>")
def get_dorm(dorm_id):
    try:
        days = parse_days(request.args.get("days", "7"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    try:
        detail = get_dorm_detail(get_supabase(), dorm_id, days)
    except Exception:
        current_app.logger.exception("Unable to load dorm details")
        return jsonify({"error": "Dorm data is unavailable. Please try again."}), 503
    if detail is None:
        return jsonify({"error": "That dorm could not be found."}), 404
    return jsonify(detail)
