import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

# Load backend .env to get MONGO_URL / DB_NAME
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def mongo():
    c = MongoClient(MONGO_URL)
    db = c[DB_NAME]
    yield db
    c.close()


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _seed_user(mongo, email, name, is_admin=False):
    user_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    session_token = f"sess_TEST_{uuid.uuid4().hex[:16]}"
    mongo.users.delete_many({"email": email})
    mongo.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": name,
        "picture": "",
        "is_admin": is_admin,
        "created_at": datetime.now(timezone.utc),
    })
    mongo.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return user_id, session_token


@pytest.fixture(scope="session")
def seeded_user(mongo):
    user_id, token = _seed_user(mongo, "TEST_user@example.com", "TEST User", is_admin=False)
    yield {"user_id": user_id, "token": token}
    mongo.user_sessions.delete_many({"user_id": user_id})
    mongo.users.delete_many({"user_id": user_id})
    mongo.carts.delete_many({"user_id": user_id})
    mongo.orders.delete_many({"user_id": user_id})
    mongo.reviews.delete_many({"user_id": user_id})


@pytest.fixture(scope="session")
def seeded_admin(mongo):
    user_id, token = _seed_user(mongo, "TEST_admin@example.com", "TEST Admin", is_admin=True)
    yield {"user_id": user_id, "token": token}
    mongo.user_sessions.delete_many({"user_id": user_id})
    mongo.users.delete_many({"user_id": user_id})


def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
