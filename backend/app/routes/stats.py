from flask import Blueprint, jsonify

stats_bp = Blueprint("stats", __name__)


@stats_bp.get("/summary")
def get_summary():
    return jsonify({
        "reports_today": 0,
        "reports_this_week": 0,
        "weekly_change": 0
    })