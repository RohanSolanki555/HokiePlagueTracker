from flask import Blueprint, jsonify
from app.services.supabase_service import get_supabase

locations_bp = Blueprint("locations", __name__)


@locations_bp.get("")
def get_locations():
    supabase = get_supabase()

    response = (
        supabase
        .table("locations")
        .select("*")
        .order("name")
        .execute()
    )

    return jsonify(response.data)