"""Tests for DELETE /api/auth/account (in-app account deletion for Play/App Store compliance)."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _mkdb():
    c = MongoClient(MONGO_URL)
    return c, c[DB_NAME]


def _seed(db, email, name, is_admin=False):
    user_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    token = f"sess_TEST_{uuid.uuid4().hex[:16]}"
    db.users.delete_many({"email": email})
    db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": name,
        "picture": "",
        "is_admin": is_admin,
        "created_at": datetime.now(timezone.utc),
    })
    db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return user_id, token


def _cleanup(db, user_id, email=None):
    db.user_sessions.delete_many({"user_id": user_id})
    db.users.delete_many({"user_id": user_id})
    if email:
        db.users.delete_many({"email": email})
    db.carts.delete_many({"user_id": user_id})
    db.orders.delete_many({"user_id": user_id})
    db.reviews.delete_many({"user_id": user_id})


# ---------- Auth required ----------
def test_delete_account_requires_auth():
    r = requests.delete(f"{BASE_URL}/api/auth/account")
    assert r.status_code == 401


def test_delete_account_bad_token():
    r = requests.delete(
        f"{BASE_URL}/api/auth/account",
        headers={"Authorization": "Bearer invalid_xxx"},
    )
    assert r.status_code == 401


# ---------- Happy path (non-admin) ----------
def test_delete_account_full_flow_non_admin():
    c, db = _mkdb()
    try:
        email = f"TEST_del_{uuid.uuid4().hex[:6]}@example.com"
        user_id, token = _seed(db, email, "TEST DeleteUser", is_admin=False)

        # Seed cart, order, review for this user
        db.carts.insert_one({"user_id": user_id, "items": [{"product_id": "p_ashwagandha", "quantity": 2}]})
        order_id = f"ord_TEST_{uuid.uuid4().hex[:8]}"
        db.orders.insert_one({
            "id": order_id,
            "user_id": user_id,
            "user_email": email,
            "user_name": "TEST DeleteUser",
            "address": {
                "full_name": "TEST DeleteUser", "phone": "+91 9999999999",
                "line1": "123 Street", "city": "Chennai", "state": "TN", "pincode": "600001",
            },
            "items": [{"product_id": "p_ashwagandha", "name": "Ashwagandha", "image": "", "price": 499.0, "quantity": 2}],
            "subtotal": 998.0, "shipping": 0.0, "total": 998.0,
            "payment_method": "upi", "status": "paid",
            "created_at": datetime.now(timezone.utc),
        })
        rev_id = f"rev_TEST_{uuid.uuid4().hex[:8]}"
        db.reviews.insert_one({
            "id": rev_id,
            "product_id": "p_ashwagandha",
            "user_id": user_id,
            "user_name": "TEST DeleteUser",
            "rating": 5,
            "comment": "Loved it",
            "created_at": datetime.now(timezone.utc),
        })

        # Call endpoint
        r = requests.delete(f"{BASE_URL}/api/auth/account", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "message" in body

        # User doc gone
        assert db.users.find_one({"user_id": user_id}) is None, "user profile must be deleted"
        # Cart gone
        assert db.carts.find_one({"user_id": user_id}) is None, "cart must be deleted"
        # Sessions gone
        assert db.user_sessions.find_one({"user_id": user_id}) is None, "sessions must be deleted"

        # Session invalidated - GET /auth/me must fail
        r2 = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r2.status_code == 401

        # Order remains but anonymised
        order = db.orders.find_one({"id": order_id})
        assert order is not None, "order should NOT be deleted"
        assert order["user_email"] == "deleted@avr.local"
        assert order["user_name"] == "Deleted user"
        assert order["address"]["full_name"] == "Deleted user"
        assert order["address"]["phone"] == ""
        assert order["address"]["line1"] == ""
        assert order["address"]["city"] == ""
        assert order["address"]["state"] == ""
        assert order["address"]["pincode"] == ""
        assert "anonymised_at" in order

        # Review remains but author anonymised
        rev = db.reviews.find_one({"id": rev_id})
        assert rev is not None, "review should NOT be deleted"
        assert rev["user_name"] == "Deleted user"
        assert rev["rating"] == 5
        assert rev["comment"] == "Loved it"
    finally:
        _cleanup(db, user_id, email)
        db.orders.delete_many({"id": order_id})
        db.reviews.delete_many({"id": rev_id})
        c.close()


# ---------- Last-admin lockout ----------
def test_delete_account_last_admin_blocked():
    c, db = _mkdb()
    user_id = None
    email = f"TEST_lastadmin_{uuid.uuid4().hex[:6]}@example.com"
    # Temporarily remove other admins
    other_admins = list(db.users.find({"is_admin": True}))
    try:
        db.users.update_many({"is_admin": True}, {"$set": {"is_admin": False}})
        user_id, token = _seed(db, email, "TEST LastAdmin", is_admin=True)

        r = requests.delete(f"{BASE_URL}/api/auth/account", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 400, f"last-admin must be blocked, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert "admin" in detail.lower()
        # user must still exist
        assert db.users.find_one({"user_id": user_id}) is not None
        # session must still exist
        assert db.user_sessions.find_one({"session_token": token}) is not None
    finally:
        # restore other admins
        for a in other_admins:
            db.users.update_one({"user_id": a["user_id"]}, {"$set": {"is_admin": True}})
        if user_id:
            _cleanup(db, user_id, email)
        c.close()


def test_delete_account_non_last_admin_succeeds():
    """If a user is admin but NOT the last admin, deletion should proceed."""
    c, db = _mkdb()
    user_id = None
    email = f"TEST_adminA_{uuid.uuid4().hex[:6]}@example.com"
    other_id, _other_tok = _seed(db, f"TEST_adminB_{uuid.uuid4().hex[:6]}@example.com", "TEST OtherAdmin", is_admin=True)
    try:
        user_id, token = _seed(db, email, "TEST AdminA", is_admin=True)
        r = requests.delete(f"{BASE_URL}/api/auth/account", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        assert db.users.find_one({"user_id": user_id}) is None, "admin profile must be deleted when not last admin"
    finally:
        if user_id:
            _cleanup(db, user_id, email)
        _cleanup(db, other_id)
        c.close()


# ---------- Privacy policy mentions deletion ----------
def test_privacy_json_mentions_account_deletion():
    r = requests.get(f"{BASE_URL}/api/privacy")
    assert r.status_code == 200
    body = r.json()
    text = body.get("text", "")
    assert "Delete my account" in text or "delete my account" in text.lower()
    assert "Profile" in text


def test_privacy_html_mentions_account_deletion():
    r = requests.get(f"{BASE_URL}/api/privacy.html")
    assert r.status_code == 200
    html = r.text
    assert "Delete my account" in html or "delete my account" in html.lower()
    assert "Profile" in html


# ---------- Regression: core endpoints still live ----------
def test_regression_products_list():
    r = requests.get(f"{BASE_URL}/api/products")
    assert r.status_code == 200
    assert "products" in r.json()


def test_regression_categories():
    r = requests.get(f"{BASE_URL}/api/products/categories")
    assert r.status_code == 200
    assert "categories" in r.json()


def test_regression_support_info():
    r = requests.get(f"{BASE_URL}/api/support/info")
    assert r.status_code == 200
    assert "email" in r.json()


def test_regression_health():
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200


def test_regression_auth_me_requires_token():
    r = requests.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 401
