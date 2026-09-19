from math import isfinite

from flask import Blueprint, current_app, jsonify, request
from app.services.map_service import get_map_data
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


@locations_bp.get("/map")
def get_location_map():
    try:
        latitude = float(request.args.get("latitude", "37.2296"))
        longitude = float(request.args.get("longitude", "-80.4139"))
        radius = float(request.args.get("radius_km", "3"))
        days = int(request.args.get("days", "7"))
        if ("latitude" in request.args) != ("longitude" in request.args):
            raise ValueError("latitude and longitude must be supplied together")
        if not isfinite(latitude) or not -90 <= latitude <= 90:
            raise ValueError("latitude must be between -90 and 90")
        if not isfinite(longitude) or not -180 <= longitude <= 180:
            raise ValueError("longitude must be between -180 and 180")
        if not isfinite(radius) or not 0.1 <= radius <= 100:
            raise ValueError("radius_km must be between 0.1 and 100")
        if not 1 <= days <= 30:
            raise ValueError("days must be between 1 and 30")
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    try:
        return jsonify(get_map_data(get_supabase(), latitude, longitude, radius, days))
    except Exception:
        current_app.logger.exception("Unable to load location map statistics")
        return jsonify({"error": "Location data is unavailable. Please try again."}), 503
