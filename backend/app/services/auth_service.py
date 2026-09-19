import re
from flask import g, jsonify, request
from supabase_auth.errors import AuthApiError
from app.services.supabase_service import get_supabase


def require_verified_user():
    parts = request.headers.get("Authorization", "").split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return jsonify({"error": "Please sign in to continue."}), 401
    try:
        user = get_supabase().auth.get_user(parts[1]).user
    except AuthApiError:
        return jsonify({"error": "Your session expired. Please sign in again."}), 401
    except Exception:
        return jsonify({"error": "Unable to verify your session. Please try again."}), 503
    if not user:
        return jsonify({"error": "Please sign in to continue."}), 401
    if not re.fullmatch(r"[^\s@]+@vt\.edu", (user.email or "").lower()) or not user.email_confirmed_at:
        return jsonify({"error": "A verified Virginia Tech email is required."}), 403
    if not user.app_metadata.get("password_setup_complete"):
        return jsonify({"error": "Finish setting up your password first."}), 403
    g.auth_user_id = user.id
    return None
