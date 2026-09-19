"""Turns a dropped map pin (coordinates and/or a Google place ID) into location metadata."""

from urllib.parse import quote

import httpx

from app.config import Config

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PLACES_URL = "https://places.googleapis.com/v1/places/"
TIMEOUT_SECONDS = 10

LOCATION_TYPES = ("Academic", "Dining", "Recreation", "Residence", "Off Campus", "Other")

# Checked in order; the first category with a matching Google place type wins.
CATEGORY_GOOGLE_TYPES = (
    ("Dining", {"restaurant", "cafe", "bakery", "bar", "food", "meal_takeaway", "meal_delivery"}),
    ("Academic", {"university", "school", "primary_school", "secondary_school", "library"}),
    ("Recreation", {"gym", "park", "stadium", "amusement_park", "bowling_alley"}),
    ("Residence", {"lodging"}),
)


class GoogleMapsNotConfigured(Exception):
    pass


class GoogleMapsError(Exception):
    """Google was unreachable or rejected the request."""


class PlaceNotFound(Exception):
    pass


def category_for(place_types):
    for category, google_types in CATEGORY_GOOGLE_TYPES:
        if google_types & set(place_types):
            return category
    return "Other"


def pick_result(results):
    # Reverse geocoding lists street addresses first; prefer a result Google
    # classifies as something we can categorise (a library, restaurant, ...).
    for result in results:
        if category_for(result.get("types", [])) != "Other":
            return result
    return results[0]


def place_display_name(place_id, api_key):
    """Business/building name via Places API (New). Best effort: None if unavailable."""
    try:
        response = httpx.get(
            PLACES_URL + quote(place_id, safe=""),
            headers={"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": "displayName"},
            timeout=TIMEOUT_SECONDS,
        )
        if response.status_code != 200:
            return None
        return response.json()["displayName"]["text"].strip() or None
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        return None


def lookup_place(latitude=None, longitude=None, place_id=None):
    api_key = Config.GOOGLE_MAPS_API_KEY
    if not api_key:
        raise GoogleMapsNotConfigured("GOOGLE_MAPS_API_KEY is not configured")

    params = {"key": api_key}
    if place_id:
        params["place_id"] = place_id
    else:
        params["latlng"] = f"{latitude},{longitude}"

    try:
        response = httpx.get(GEOCODE_URL, params=params, timeout=TIMEOUT_SECONDS)
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        # Drop the original exception: its request URL contains the API key.
        raise GoogleMapsError("Google Maps request failed") from None

    status = payload.get("status")
    if status == "ZERO_RESULTS":
        raise PlaceNotFound("Google has no address information for that pin")
    if status != "OK" or not payload.get("results"):
        raise GoogleMapsError(f"Google Maps returned {status}: {payload.get('error_message', 'no details')}")

    result = pick_result(payload["results"])
    place_types = result.get("types", [])
    formatted_address = result.get("formatted_address")
    if latitude is None or longitude is None:
        point = result.get("geometry", {}).get("location", {})
        latitude, longitude = point.get("lat"), point.get("lng")
    if latitude is None or longitude is None:
        raise GoogleMapsError("Google Maps returned no coordinates for that place")

    name = place_display_name(result["place_id"], api_key) if result.get("place_id") else None
    if not name and formatted_address:
        name = formatted_address.split(",")[0].strip()

    return {
        "place_id": result.get("place_id"),
        "name": name,
        "formatted_address": formatted_address,
        "location_type": category_for(place_types),
        "latitude": latitude,
        "longitude": longitude,
        "place_types": place_types,
        "address_components": result.get("address_components", []),
    }
