from math import isfinite

from flask import Blueprint, current_app, jsonify, request
from app.services.google_maps_service import (
    LOCATION_TYPES,
    GoogleMapsError,
    GoogleMapsNotConfigured,
    PlaceNotFound,
    lookup_place,
)
from app.services.map_service import get_map_data, save_pinned_location
from app.services.supabase_service import get_supabase

locations_bp = Blueprint("locations", __name__)


def read_pin_request():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValueError("A JSON request body is required")

    def coordinate(field, limit):
        value = data.get(field)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{field} must be a number")
        if not isfinite(value) or not -limit <= value <= limit:
            raise ValueError(f"{field} must be between -{limit} and {limit}")
        return float(value)

    def text(field, max_length):
        value = data.get(field)
        if value is None:
            return None
        if not isinstance(value, str) or len(value.strip()) > max_length:
            raise ValueError(f"{field} must be text of at most {max_length} characters")
        return value.strip() or None

    latitude = coordinate("latitude", 90)
    longitude = coordinate("longitude", 180)
    place_id = text("place_id", 300)
    address = text("address", 500)
    if "address" in data and not address:
        raise ValueError("address must contain 1-500 characters")
    if address and (latitude is not None or longitude is not None or place_id is not None):
        raise ValueError("Provide an address on its own, without coordinates or a place_id")
    if (latitude is None) != (longitude is None):
        raise ValueError("latitude and longitude must be supplied together")
    if latitude is None and place_id is None and address is None:
        raise ValueError("Provide an address, latitude and longitude, or a place_id")
    location_type = text("location_type", 50)
    if location_type is not None and location_type not in LOCATION_TYPES:
        raise ValueError(f"location_type must be one of: {', '.join(LOCATION_TYPES)}")
    return latitude, longitude, place_id, text("name", 120), location_type, address


def resolve_pin():
    """Returns (metadata, None) or (None, error response)."""
    try:
        latitude, longitude, place_id, name, location_type, address = read_pin_request()
        metadata = lookup_place(latitude, longitude, place_id, address=address)
    except ValueError as error:
        return None, (jsonify({"error": str(error)}), 400)
    except PlaceNotFound as error:
        return None, (jsonify({"error": str(error)}), 404)
    except GoogleMapsNotConfigured:
        current_app.logger.error("GOOGLE_MAPS_API_KEY is not configured")
        return None, (jsonify({"error": "Google Maps is not configured on the server."}), 503)
    except GoogleMapsError:
        current_app.logger.exception("Google Maps lookup failed")
        return None, (jsonify({"error": "Google Maps could not look up that pin. Please try again."}), 502)

    metadata["name"] = name or metadata["name"] or f"{metadata['latitude']:.5f}, {metadata['longitude']:.5f}"
    metadata["location_type"] = location_type or metadata["location_type"]
    return metadata, None


@locations_bp.post("/lookup")
def lookup_location():
    metadata, error = resolve_pin()
    return error or jsonify(metadata)


@locations_bp.post("/pin")
def pin_location():
    metadata, error = resolve_pin()
    if error:
        return error
    try:
        location, created = save_pinned_location(get_supabase(), metadata)
    except Exception:
        current_app.logger.exception("Unable to save pinned location")
        return jsonify({"error": "The location could not be saved. Please try again."}), 503
    return jsonify({"location": location, "created": created}), 201 if created else 200


@locations_bp.get("")
def get_locations():
    supabase = get_supabase()

    # Dorms only, and only public columns: other rows may be private address-derived pins.
    response = (
        supabase
        .table("locations")
        .select("id,name,location_type,latitude,longitude,floors")
        .eq("is_dorm", True)
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
