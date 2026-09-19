from flask import Blueprint, current_app, jsonify, request
from postgrest.exceptions import APIError

from app.services.google_maps_service import (
    GoogleMapsError,
    GoogleMapsNotConfigured,
    PlaceNotFound,
    lookup_place,
)
from app.services.map_service import save_pinned_location
from app.services.supabase_service import get_supabase

reports_bp = Blueprint("reports", __name__)

ILLNESSES = (
    "Common cold",
    "COVID-19",
    "Flu",
    "Strep throat",
    "Mononucleosis (mono)",
    "Norovirus",
    "Stomach bug",
    "RSV",
    "Pink eye (conjunctivitis)",
    "Sinus infection",
    "Other",
)


@reports_bp.get("")
def get_reports():
    supabase = get_supabase()

    response = (
        supabase
        .table("reports")
        .select("id,location_id,severity,created_at")
        .order("created_at", desc=True)
        .execute()
    )

    return jsonify(response.data)


@reports_bp.post("")
def create_report():
    data = request.get_json(silent=True)

    if not isinstance(data, dict) or not data:
        return jsonify({"error": "Request body is required"}), 400

    severity = data.get("severity")
    address = data.get("address")
    illness = data.get("illness")

    for name, value, limit in (("address", address, 500), ("illness", illness, 200)):
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
            return jsonify({"error": f"{name} must contain 1-{limit} characters"}), 400

    if illness.strip() not in ILLNESSES:
        return jsonify({"error": "Select an illness from the provided list"}), 400

    flu_type = data.get("flu_type")
    if flu_type is not None:
        if illness.strip() != "Flu" or flu_type not in ("A", "B"):
            return jsonify({"error": "Flu type must be A or B and can only be selected for Flu"}), 400

    if type(severity) is not int or not 1 <= severity <= 5:
        return jsonify({"error": "severity must be an integer between 1 and 5"}), 400

    # Accept the legacy optional field, but only the resolved address determines
    # the report's location. A client cannot redirect counts to another pin.
    location_id = data.get("location_id")
    if location_id is not None and (type(location_id) is not int or location_id < 1):
        return jsonify({"error": "location_id must be a positive integer"}), 400

    try:
        metadata = lookup_place(address=address.strip())
    except PlaceNotFound as error:
        return jsonify({"error": str(error)}), 404
    except GoogleMapsNotConfigured:
        current_app.logger.error("Report address lookup is not configured")
        return jsonify({"error": "Address lookup is unavailable. Please try again later."}), 503
    except GoogleMapsError:
        current_app.logger.error("Report address lookup failed")
        return jsonify({"error": "Unable to look up that address. Please try again."}), 502

    metadata["name"] = metadata["name"] or f"{metadata['latitude']:.5f}, {metadata['longitude']:.5f}"

    try:
        supabase = get_supabase()
        location, _created = save_pinned_location(supabase, metadata)
    except Exception:
        current_app.logger.error("Report location storage is unavailable")
        return jsonify({"error": "Unable to save your report's location. Please try again later."}), 503

    report = {
        "location_id": location["id"],
        "severity": severity,
        "address": address.strip(),
        "illness": f"Flu {flu_type}" if flu_type is not None else illness.strip(),
    }

    try:
        response = supabase.table("reports").insert(report).execute()
    except APIError as error:
        if error.code == "23503":
            return jsonify({"error": "The selected location does not exist"}), 400
        current_app.logger.error("Report insert failed (%s)", error.code)
        return jsonify({"error": "Unable to save your report. Please try again later."}), 503
    except Exception:
        current_app.logger.error("Report storage is unavailable")
        return jsonify({"error": "Unable to save your report. Please try again later."}), 503

    if not response.data:
        return jsonify({"error": "The report could not be confirmed as saved."}), 503

    # Do not return the report's private address/illness or extra place metadata.
    return jsonify({
        "report": {
            key: response.data[0][key]
            for key in ("id", "location_id", "severity", "created_at")
        },
        "location": {
            key: location[key]
            for key in ("id", "name", "location_type", "latitude", "longitude")
        },
    }), 201
