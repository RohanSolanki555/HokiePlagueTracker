from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify
from app.services.map_service import read_reports, summarize_reports
from app.services.supabase_service import get_supabase

stats_bp = Blueprint("stats", __name__)


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
