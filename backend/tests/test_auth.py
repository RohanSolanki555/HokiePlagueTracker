from types import SimpleNamespace
from unittest.mock import patch

import pytest
from supabase_auth.errors import AuthApiError
from app import create_app


@pytest.fixture
def client():
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


@pytest.mark.parametrize("path", ["/api/reports", "/api/locations", "/api/stats/summary", "/api/test/supabase"])
def test_api_requires_login(client, path):
    assert client.get(path).status_code == 401


def test_submission_requires_login(client):
    assert client.post("/api/reports", json={}).status_code == 401


def test_health_and_preflight_are_public(client):
    assert client.get("/api/health").status_code == 200
    assert client.options("/api/reports").status_code == 200


@pytest.mark.parametrize("email,confirmed,complete,status", [
    ("student@vt.edu", "today", True, 400),
    ("student@vt.edu.evil.com", "today", True, 403),
    ("student@gmail.com", "today", True, 403),
    ("student@vt.edu", None, True, 403),
    ("student@vt.edu", "today", False, 403),
])
def test_verified_vt_user_required(client, email, confirmed, complete, status):
    with patch("app.services.auth_service.get_supabase") as factory:
        factory.return_value.auth.get_user.return_value.user = SimpleNamespace(
            id="user-id", email=email, email_confirmed_at=confirmed,
            app_metadata={"password_setup_complete": complete},
        )
        # Empty report returns validation error only after authentication succeeds.
        response = client.post("/api/reports", json={}, headers={"Authorization": "Bearer token"})
        assert response.status_code == status
        factory.return_value.auth.get_user.assert_called_once_with("token")


def test_auth_unavailable_fails_closed(client):
    with patch("app.services.auth_service.get_supabase", side_effect=RuntimeError("secret")):
        response = client.get("/api/reports", headers={"Authorization": "Bearer token"})
    assert response.status_code == 503
    assert "secret" not in response.get_data(as_text=True)


def test_invalid_token_is_rejected(client):
    with patch("app.services.auth_service.get_supabase") as factory:
        factory.return_value.auth.get_user.side_effect = AuthApiError("Invalid JWT", 401, "bad_jwt")
        response = client.get("/api/reports", headers={"Authorization": "Bearer forged-token"})
    assert response.status_code == 401
