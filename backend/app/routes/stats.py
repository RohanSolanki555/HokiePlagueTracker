from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request
from app.services.map_service import read_reports, summarize_reports
from app.services.report_period import parse_days
from app.services.stats_service import get_illness_summary
from app.services.supabase_service import get_supabase

stats_bp = Blueprint("stats", __name__)


@stats_bp.get("/illnesses")
def get_illnesses():
    try:
        days = parse_days(request.args.get("days", "7"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    try:
        return jsonify(get_illness_summary(get_supabase(), days))
    except Exception:
        current_app.logger.exception("Unable to load illness summary")
        return jsonify({"error": "Illness statistics are unavailable. Please try again."}), 503


@stats_bp.get("/summary")
def get_summary():
    now = datetime.now(timezone.utc)
    try:
        stats = summarize_reports(
            read_reports(get_supabase(), now - timedelta(days=14), now), now, 7
        )
    except Exception:
        current_app.logger.exception("Unable to load report summary")
        return jsonify({"error": "Report statistics are unavailable. Please try again."}), 503
    return jsonify({
        "reports_today": stats["reports_today"],
        "reports_this_week": stats["total_reports"],
        "weekly_change": stats["change_percent"],
    })
