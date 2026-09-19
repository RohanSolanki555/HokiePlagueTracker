from supabase import create_client, Client
from app.config import Config


def get_supabase() -> Client:
    if not Config.SUPABASE_URL:
        raise RuntimeError("SUPABASE_URL is not configured")

    if not Config.SUPABASE_KEY:
        raise RuntimeError("SUPABASE_KEY is not configured")

    return create_client(
        Config.SUPABASE_URL,
        Config.SUPABASE_KEY
    )