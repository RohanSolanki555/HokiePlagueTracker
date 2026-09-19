from flask import Flask, request
from app.services.auth_service import require_verified_user
from flask_cors import CORS

from app.routes.test_supabase import test_supabase_bp
from app.config import Config
from app.routes.health import health_bp
from app.routes.reports import reports_bp
from app.routes.locations import locations_bp
from app.routes.stats import stats_bp


def create_app():
    app = Flask(__name__)

    @app.before_request
    def authenticate_api():
        if request.method != "OPTIONS" and request.path.startswith("/api/") and request.path != "/api/health":
            return require_verified_user()

    CORS(
        app,
        origins=[Config.FRONTEND_URL]
    )

    app.register_blueprint(
        health_bp,
        url_prefix="/api"
    )

    app.register_blueprint(
    test_supabase_bp,
    url_prefix="/api/test"
)

    app.register_blueprint(
        reports_bp,
        url_prefix="/api/reports"
    )

    app.register_blueprint(
        locations_bp,
        url_prefix="/api/locations"
    )

    app.register_blueprint(
        stats_bp,
        url_prefix="/api/stats"
    )

    return app
