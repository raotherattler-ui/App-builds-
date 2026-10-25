# Tests for the admin-managed News Banner feature (settings.key='news_banner').
# Endpoints:
#   - GET /api/news-banner          (public; hides image/caption when active=False)
#   - GET /api/admin/news-banner    (admin; raw stored values)
#   - PUT /api/admin/news-banner    (admin; upsert, trims whitespace)
import os
import pytest
import requests

from conftest import auth_headers

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
PUB = f"{BASE_URL}/api/news-banner"
ADM = f"{BASE_URL}/api/admin/news-banner"


@pytest.fixture
def banner_snapshot(mongo):
    """Snapshot & restore the news_banner settings doc around each test."""
    before = mongo.settings.find_one({"key": "news_banner"})
    try:
        yield
    finally:
        if before is None:
            mongo.settings.delete_many({"key": "news_banner"})
        else:
            before.pop("_id", None)
            mongo.settings.replace_one({"key": "news_banner"}, before, upsert=True)


# A. Default state when nothing is set
class TestDefaultState:
    def test_public_default_when_unset(self, api, mongo, banner_snapshot):
        mongo.settings.delete_many({"key": "news_banner"})
        r = api.get(PUB)
        assert r.status_code == 200, r.text
        assert r.json() == {"image_url": "", "caption": "", "active": True}

    def test_admin_default_when_unset(self, api, mongo, seeded_admin, banner_snapshot):
        mongo.settings.delete_many({"key": "news_banner"})
        r = api.get(ADM, headers=auth_headers(seeded_admin["token"]))
        assert r.status_code == 200, r.text
        assert r.json() == {"image_url": "", "caption": "", "active": True}


# B. Admin auth gating
class TestAuthGating:
    def test_admin_get_no_auth(self):
        r = requests.get(ADM)
        assert r.status_code in (401, 403), r.status_code

    def test_admin_put_no_auth(self, banner_snapshot):
        r = requests.put(ADM, json={"image_url": "https://x.com/a.jpg", "caption": "x", "active": True})
        assert r.status_code in (401, 403), r.status_code

    def test_admin_get_non_admin_forbidden(self, api, seeded_user):
        r = api.get(ADM, headers=auth_headers(seeded_user["token"]))
        assert r.status_code == 403, r.status_code

    def test_admin_put_non_admin_forbidden(self, api, mongo, seeded_user, banner_snapshot):
        before = mongo.settings.find_one({"key": "news_banner"}, {"_id": 0})
        r = api.put(ADM, json={"image_url": "https://evil.com/a.jpg", "caption": "hacked", "active": True},
                    headers=auth_headers(seeded_user["token"]))
        assert r.status_code == 403, r.status_code
        assert mongo.settings.find_one({"key": "news_banner"}, {"_id": 0}) == before

    def test_admin_put_invalid_token(self, api, banner_snapshot):
        r = api.put(ADM, json={"image_url": "", "caption": "", "active": True},
                    headers=auth_headers("bogus_token_xyz"))
        assert r.status_code in (401, 403), r.status_code


# C/D/E/F. Round-trip, toggle, clear, trimming
class TestRoundTrip:
    def test_put_get_roundtrip(self, api, seeded_admin, banner_snapshot):
        h = auth_headers(seeded_admin["token"])
        body = {"image_url": "https://example.com/banner.jpg", "caption": "Diwali sale!", "active": True}
        r = api.put(ADM, json=body, headers=h)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, **body}
        assert api.get(ADM, headers=h).json() == body
        assert api.get(PUB).json() == body

    def test_toggle_off_hides_public_preserves_admin(self, api, seeded_admin, banner_snapshot):
        h = auth_headers(seeded_admin["token"])
        api.put(ADM, json={"image_url": "https://example.com/banner.jpg", "caption": "Diwali sale!", "active": True}, headers=h)
        r = api.put(ADM, json={"image_url": "https://example.com/banner.jpg", "caption": "Diwali sale!", "active": False}, headers=h)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "image_url": "https://example.com/banner.jpg", "caption": "Diwali sale!", "active": False}
        assert api.get(PUB).json() == {"image_url": "", "caption": "", "active": False}
        assert api.get(ADM, headers=h).json() == {
            "image_url": "https://example.com/banner.jpg", "caption": "Diwali sale!", "active": False}
        # Toggle back on restores public visibility
        api.put(ADM, json={"image_url": "https://example.com/banner.jpg", "caption": "Diwali sale!", "active": True}, headers=h)
        assert api.get(PUB).json()["image_url"] == "https://example.com/banner.jpg"

    def test_clear(self, api, seeded_admin, banner_snapshot):
        h = auth_headers(seeded_admin["token"])
        api.put(ADM, json={"image_url": "https://example.com/banner.jpg", "caption": "x", "active": True}, headers=h)
        r = api.put(ADM, json={"image_url": "", "caption": "", "active": True}, headers=h)
        assert r.status_code == 200
        pub = api.get(PUB).json()
        assert pub["image_url"] == "" and pub["caption"] == ""

    def test_whitespace_trim(self, api, mongo, seeded_admin, banner_snapshot):
        h = auth_headers(seeded_admin["token"])
        r = api.put(ADM, json={"image_url": "  https://example.com/x.jpg  ", "caption": "  Hello  ", "active": True}, headers=h)
        assert r.status_code == 200
        assert r.json()["image_url"] == "https://example.com/x.jpg"
        assert r.json()["caption"] == "Hello"
        stored = mongo.settings.find_one({"key": "news_banner"})
        assert stored["image_url"] == "https://example.com/x.jpg"
        assert stored["caption"] == "Hello"
        assert api.get(PUB).json()["image_url"] == "https://example.com/x.jpg"
        assert api.get(ADM, headers=h).json()["image_url"] == "https://example.com/x.jpg"

    # Edge/observational: non-http URL is accepted (no validation)
    def test_non_http_url_accepted_observation(self, api, seeded_admin, banner_snapshot):
        h = auth_headers(seeded_admin["token"])
        r = api.put(ADM, json={"image_url": "javascript:alert(1)", "caption": "", "active": True}, headers=h)
        print(f"non-http URL PUT status={r.status_code} body={r.text}")
        assert r.status_code in (200, 400, 422)

    def test_partial_body_defaults(self, api, seeded_admin, banner_snapshot):
        h = auth_headers(seeded_admin["token"])
        r = api.put(ADM, json={}, headers=h)
        print(f"empty body PUT status={r.status_code} body={r.text}")
        assert r.status_code == 200
        assert r.json() == {"ok": True, "image_url": "", "caption": "", "active": True}
