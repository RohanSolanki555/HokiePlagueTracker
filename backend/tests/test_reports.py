from unittest.mock import patch

import pytest
from flask import Flask
from postgrest.exceptions import APIError

from app.routes.reports import ILLNESSES, reports_bp
from app.services.google_maps_service import (
    GoogleMapsError,
    GoogleMapsNotConfigured,
    PlaceNotFound,
)

LOCATION = {
    "id": 42, "name": "123 Main St", "location_type": "Other",
    "latitude": 37.2296, "longitude": -80.4139, "place_id": "test-place",
    "formatted_address": "123 Main St, Blacksburg, VA 24060",
}
PUBLIC_REPORT = {
    "id": 1, "location_id": 42, "severity": 3,
    "created_at": "2026-09-19T12:00:00Z",
}


@pytest.fixture
def client():
    app = Flask(__name__)
    app.register_blueprint(reports_bp, url_prefix="/api/reports")
    return app.test_client()


@pytest.fixture
def storage():
    with patch("app.routes.reports.get_supabase") as factory:
        storage = factory.return_value
        storage.table.return_value.insert.return_value.execute.return_value.data = [{
            **PUBLIC_REPORT, "address": "123 Main St", "illness": "Flu",
        }]
        yield storage


@pytest.fixture(autouse=True)
def lookup():
    with patch("app.routes.reports.lookup_place", return_value=dict(LOCATION)) as lookup:
        yield lookup


@pytest.fixture(autouse=True)
def pin():
    with patch("app.routes.reports.save_pinned_location", return_value=(LOCATION, False)) as pin:
        yield pin


def test_saves_details_and_resolved_location_without_returning_private_fields(client, storage, lookup, pin):
    response = client.post("/api/reports", json={
        "address": " 123 Main St ", "illness": " Flu ", "severity": 3,
    })
    assert response.status_code == 201
    lookup.assert_called_once_with(address="123 Main St")
    pin.assert_called_once_with(storage, lookup.return_value)
    storage.table.return_value.insert.assert_called_once_with({
        "address": "123 Main St", "illness": "Flu", "severity": 3, "location_id": 42,
    })
    assert response.json == {
        "report": PUBLIC_REPORT,
        "location": {key: LOCATION[key] for key in (
            "id", "name", "location_type", "latitude", "longitude",
        )},
    }


def test_legacy_location_id_cannot_redirect_a_report_to_an_unrelated_pin(client, storage):
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": "Flu", "severity": 3, "location_id": 999,
    })
    assert response.status_code == 201
    assert storage.table.return_value.insert.call_args.args[0]["location_id"] == 42
    assert response.json["report"]["location_id"] == response.json["location"]["id"] == 42


@pytest.mark.parametrize("override", [
    {"address": " "}, {"address": "x" * 501}, {"address": 123},
    {"illness": ""}, {"illness": "x" * 201}, {"illness": None},
    {"illness": "Cough"}, {"illness": "invented illness"},
    {"severity": 0}, {"severity": 6}, {"severity": True}, {"severity": "3"},
    {"location_id": -1}, {"location_id": True},
])
def test_rejects_invalid_fields_before_geocoding_or_storage(client, storage, lookup, pin, override):
    payload = {"address": "123 Main St", "illness": "Flu", "severity": 3}
    payload.update(override)
    assert client.post("/api/reports", json=payload).status_code == 400
    lookup.assert_not_called()
    pin.assert_not_called()
    storage.table.assert_not_called()


@pytest.mark.parametrize("payload", [[], "text", 5, {}])
def test_rejects_non_object_or_empty_body(client, storage, lookup, payload):
    assert client.post("/api/reports", json=payload).status_code == 400
    lookup.assert_not_called()
    storage.table.assert_not_called()


@pytest.mark.parametrize("error,status", [
    (PlaceNotFound("No location found for that address."), 404),
    (GoogleMapsNotConfigured("private configuration"), 503),
    (GoogleMapsError("private Google details and API key"), 502),
])
def test_address_lookup_failure_does_not_save_a_report(client, storage, lookup, pin, error, status):
    lookup.side_effect = error
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": "Flu", "severity": 3,
    })
    assert response.status_code == status
    assert "address" in response.json["error"].lower()
    assert "private" not in response.get_data(as_text=True)
    pin.assert_not_called()
    storage.table.assert_not_called()


def test_pin_storage_failure_does_not_insert_a_report(client, storage, pin):
    pin.side_effect = RuntimeError("private location details")
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": "Flu", "severity": 3,
    })
    assert response.status_code == 503
    assert "private" not in response.get_data(as_text=True)
    storage.table.assert_not_called()


@pytest.mark.parametrize("error", [
    RuntimeError("secret"),
    APIError({"code": "08000", "message": "secret", "details": None, "hint": None}),
])
def test_storage_failure_does_not_expose_details(client, storage, error):
    storage.table.return_value.insert.return_value.execute.side_effect = error
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": "Flu", "severity": 3,
    })
    assert response.status_code == 503
    assert "secret" not in response.get_data(as_text=True)


def test_location_removed_before_report_insert_returns_an_error(client, storage):
    storage.table.return_value.insert.return_value.execute.side_effect = APIError({
        "code": "23503", "message": "Foreign key violation", "details": None, "hint": None,
    })
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": "Flu", "severity": 3,
    })
    assert response.status_code == 400


def test_empty_insert_response_is_not_reported_as_success(client, storage):
    storage.table.return_value.insert.return_value.execute.return_value.data = []
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": "Flu", "severity": 3,
    })
    assert response.status_code == 503


def test_public_report_query_excludes_private_details(client, storage):
    storage.table.return_value.select.return_value.order.return_value.execute.return_value.data = []
    assert client.get("/api/reports").status_code == 200
    storage.table.return_value.select.assert_called_once_with("id,location_id,severity,created_at")


@pytest.mark.parametrize("illness", ILLNESSES)
def test_accepts_each_supported_illness(client, storage, illness):
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": illness, "severity": 3,
    })
    assert response.status_code == 201
    assert storage.table.return_value.insert.call_args.args[0]["illness"] == illness


@pytest.mark.parametrize("flu_type", ["A", "B"])
def test_saves_flu_type(client, storage, flu_type):
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": "Flu", "flu_type": flu_type, "severity": 3,
    })
    assert response.status_code == 201
    assert storage.table.return_value.insert.call_args.args[0]["illness"] == f"Flu {flu_type}"


@pytest.mark.parametrize("illness,flu_type", [
    ("Flu", "C"), ("Flu", ""), ("Flu", 1), ("Flu", ["A"]),
    ("Flu", {"type": "A"}), ("Common cold", "A"), ("Stomach bug", "B"),
])
def test_rejects_invalid_flu_type(client, storage, lookup, illness, flu_type):
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": illness, "flu_type": flu_type, "severity": 3,
    })
    assert response.status_code == 400
    lookup.assert_not_called()
    storage.table.assert_not_called()
