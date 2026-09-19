from flask import Blueprint, jsonify
from app.services.supabase_service import get_supabase

test_supabase_bp = Blueprint("test_supabase", __name__)


@test_supabase_bp.get("/supabase")
def test_supabase():
    try:
        supabase = get_supabase()

        response = (
            supabase
            .table("symptoms")
            .select("*")
            .execute()
        )

        return jsonify({
            "status": "connected",
            "symptoms": response.data
        })

    except Exception as error:
        return jsonify({
            "status": "error",
            "message": str(error)
        }), 500