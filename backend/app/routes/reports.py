from flask import Blueprint, current_app, jsonify, request
from postgrest.exceptions import APIError

from app.services.google_maps_service import (
    GoogleMapsError,
    GoogleMapsNotConfigured,
    PlaceNotFound,
    lookup_place,
)
from app.services.map_service import blur_to_area
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
MAX_FLOOR = 60


def is_positive_int(value, maximum=None):
    return type(value) is int and value >= 1 and (maximum is None or value <= maximum)


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
    illness = data.get("illness")

    if not isinstance(illness, str) or not illness.strip() or len(illness.strip()) > 200:
        return jsonify({"error": "illness must contain 1-200 characters"}), 400

    if illness.strip() not in ILLNESSES:
        return jsonify({"error": "Select an illness from the provided list"}), 400

    flu_type = data.get("flu_type")
    if flu_type is not None:
        if illness.strip() != "Flu" or flu_type not in ("A", "B"):
            return jsonify({"error": "Flu type must be A or B and can only be selected for Flu"}), 400

    if type(severity) is not int or not 1 <= severity <= 5:
        return jsonify({"error": "severity must be an integer between 1 and 5"}), 400

    # Clients that predate the dorm option send only an address.
    residence_type = data.get("residence_type", "home")
    if residence_type not in ("dorm", "home"):
        return jsonify({"error": "residence_type must be dorm or home"}), 400

    report = {
        "residence_type": residence_type,
        "severity": severity,
        "illness": f"Flu {flu_type}" if flu_type is not None else illness.strip(),
    }

    if residence_type == "dorm":
        dorm_id, floor = data.get("dorm_id"), data.get("floor")
        if not is_positive_int(dorm_id):
            return jsonify({"error": "Select a dorm from the list"}), 400
        if not is_positive_int(floor, MAX_FLOOR):
            return jsonify({"error": f"floor must be a whole number from 1 to {MAX_FLOOR}"}), 400
        try:
            dorms = (
                get_supabase().table("locations").select("id,floors")
                .eq("id", dorm_id).eq("is_dorm", True).limit(1).execute().data
            )
        except Exception:
            current_app.logger.error("Dorm lookup is unavailable")
            return jsonify({"error": "Unable to save your report. Please try again later."}), 503
        if not dorms:
            return jsonify({"error": "Select a dorm from the list"}), 400
        if dorms[0].get("floors") and floor > dorms[0]["floors"]:
            return jsonify({"error": f"That dorm has floors 1 to {dorms[0]['floors']}"}), 400
        report.update({"location_id": dorm_id, "floor": floor})
    else:
        address = data.get("address")
        if not isinstance(address, str) or not address.strip() or len(address.strip()) > 500:
            return jsonify({"error": "address must contain 1-500 characters"}), 400
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
        # Only the blurred cell is kept: no address, coordinates or location row.
        area_latitude, area_longitude = blur_to_area(metadata["latitude"], metadata["longitude"])
        report.update({"location_id": None, "area_latitude": area_latitude, "area_longitude": area_longitude})

    try:
        response = get_supabase().table("reports").insert(report).execute()
    except APIError as error:
        if error.code == "23503":
            return jsonify({"error": "The selected dorm does not exist"}), 400
        current_app.logger.error("Report insert failed (%s)", error.code)
        return jsonify({"error": "Unable to save your report. Please try again later."}), 503
    except Exception:
        current_app.logger.error("Report storage is unavailable")
        return jsonify({"error": "Unable to save your report. Please try again later."}), 503

    if not response.data:
        return jsonify({"error": "The report could not be confirmed as saved."}), 503

    # Never echo a home report's position or any other private detail.
    return jsonify({
        "report": {
            key: response.data[0].get(key)
            for key in ("id", "location_id", "severity", "created_at")
        },
    }), 201
