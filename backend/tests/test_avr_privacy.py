# Tests for public Privacy Policy endpoints (Play Store compliance)
# - GET /api/privacy.html  (public HTML — the URL submitted to Google Play)
# - GET /api/privacy (JSON)
# Also runs regression spot-checks against previously green endpoints.

import os
import re
import io
import json
import pytest
import requests

from conftest import auth_headers

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

# All 9 required sections (headings) from the policy
REQUIRED_SECTIONS = [
    "1. Information we collect",
    "2. How we use your information",
    "3. Payments",
    "4. Sharing",
    "5. Data retention",
    "6. Your rights",
    "7. Children",
    "8. Changes to this policy",
    "9. Contact",
]

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ---------- /api/privacy.html (HTML, public — Play Store URL) ----------
class TestPrivacyHtml:
    def test_html_status_and_content_type(self, api):
        r = api.get(f"{BASE_URL}/api/privacy.html")
        assert r.status_code == 200, r.text
        ctype = r.headers.get("content-type", "")
        assert "text/html" in ctype.lower(), f"content-type was {ctype!r}"

    def test_html_body_keywords(self, api):
        r = api.get(f"{BASE_URL}/api/privacy.html")
        body = r.text
        assert "Privacy Policy" in body
        assert "AVR Organics" in body
        assert "Last updated" in body
        assert "support@herbalbloom.app" in body

    def test_html_contains_all_9_sections(self, api):
        r = api.get(f"{BASE_URL}/api/privacy.html")
        body = r.text
        missing = [s for s in REQUIRED_SECTIONS if s not in body]
        assert not missing, f"Missing sections in HTML: {missing}"

    def test_html_no_auth_required(self):
        # Make a bare request with no cookies / no auth headers
        r = requests.get(f"{BASE_URL}/api/privacy.html", timeout=15)
        assert r.status_code == 200
        assert "Privacy Policy" in r.text


# ---------- /api/privacy (JSON) ----------
class TestPrivacyJson:
    def test_json_status_and_keys(self, api):
        r = api.get(f"{BASE_URL}/api/privacy")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("last_updated", "contact_email", "contact_whatsapp", "text"):
            assert k in data, f"missing key: {k}"

    def test_json_last_updated_is_iso_date(self, api):
        data = api.get(f"{BASE_URL}/api/privacy").json()
        assert isinstance(data["last_updated"], str)
        assert ISO_DATE_RE.match(data["last_updated"]), \
            f"last_updated not ISO yyyy-mm-dd: {data['last_updated']!r}"

    def test_json_contact_fields(self, api):
        data = api.get(f"{BASE_URL}/api/privacy").json()
        assert data["contact_email"] == "support@herbalbloom.app"
        assert "9677337727" in data["contact_whatsapp"].replace(" ", "")

    def test_json_text_contains_all_9_sections(self, api):
        data = api.get(f"{BASE_URL}/api/privacy").json()
        text = data["text"]
        missing = [s for s in REQUIRED_SECTIONS if s not in text]
        assert not missing, f"Missing sections in JSON text: {missing}"

    def test_json_no_auth_required(self):
        r = requests.get(f"{BASE_URL}/api/privacy", timeout=15)
        assert r.status_code == 200


# ---------- Regression: previously green endpoints still work ----------
class TestRegressionGreenEndpoints:
    def test_api_health(self, api):
        r = api.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_products_list(self, api):
        r = api.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        body = r.json()
        assert "products" in body
        assert isinstance(body["products"], list)

    def test_products_categories(self, api):
        r = api.get(f"{BASE_URL}/api/products/categories")
        assert r.status_code == 200
        body = r.json()
        assert "categories" in body
        assert "All" in body["categories"]

    def test_product_by_id(self, api):
        # Use seeded product
        r = api.get(f"{BASE_URL}/api/products/p_ashwagandha")
        assert r.status_code == 200
        assert r.json()["product"]["id"] == "p_ashwagandha"

    def test_admin_products_export(self, api, seeded_admin):
        r = api.get(f"{BASE_URL}/api/admin/products/export",
                    headers=auth_headers(seeded_admin["token"]))
        assert r.status_code == 200
        body = r.json()
        assert "products" in body and "categories" in body and "count" in body
        assert isinstance(body["count"], int)

    def test_admin_products_bulk_import(self, api, seeded_admin, mongo):
        payload = {
            "products": [{
                "id": "p_TEST_privacy_regress",
                "name": "TEST_PrivacyRegression",
                "price": 9.0,
                "category": "Capsules",
            }],
            "overwrite": True,
        }
        r = api.post(f"{BASE_URL}/api/admin/products/bulk-import",
                     headers=auth_headers(seeded_admin["token"]),
                     data=json.dumps(payload))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert (body.get("imported", 0) + body.get("overwritten", 0)) >= 1
        # Verify persistence
        got = api.get(f"{BASE_URL}/api/products/p_TEST_privacy_regress")
        assert got.status_code == 200
        # cleanup
        mongo.products.delete_many({"id": "p_TEST_privacy_regress"})

    def test_orders_me(self, api, seeded_user):
        r = api.get(f"{BASE_URL}/api/orders/me",
                    headers=auth_headers(seeded_user["token"]))
        assert r.status_code == 200
        assert "orders" in r.json()

    def test_admin_order_status_update_404(self, api, seeded_admin):
        # Nonexistent order -> 404 (endpoint reachable)
        r = api.put(f"{BASE_URL}/api/admin/orders/does_not_exist/status",
                    headers=auth_headers(seeded_admin["token"]),
                    data=json.dumps({"status": "shipped"}))
        assert r.status_code == 404

    def test_upload_requires_admin(self, api, seeded_user):
        # Non-admin should be 403; endpoint reachable
        files = {"file": ("t.png", io.BytesIO(b"fake"), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/upload",
            headers={"Authorization": f"Bearer {seeded_user['token']}"},
            files=files,
            timeout=30,
        )
        assert r.status_code in (403, 401), r.text

    def test_auth_session_invalid(self, api):
        r = api.post(f"{BASE_URL}/api/auth/session",
                     data=json.dumps({"session_id": "invalid_TEST"}))
        assert r.status_code == 401

    def test_support_info(self, api):
        r = api.get(f"{BASE_URL}/api/support/info")
        assert r.status_code == 200
        body = r.json()
        for k in ("email", "whatsapp", "whatsapp_link"):
            assert k in body

    def test_admin_categories_list(self, api, seeded_admin):
        r = api.get(f"{BASE_URL}/api/admin/categories",
                    headers=auth_headers(seeded_admin["token"]))
        assert r.status_code == 200
        assert "categories" in r.json()

    def test_admin_admins_list(self, api, seeded_admin):
        r = api.get(f"{BASE_URL}/api/admin/admins",
                    headers=auth_headers(seeded_admin["token"]))
        assert r.status_code == 200
        assert "admins" in r.json()
        # must include the seeded admin
        emails = [a.get("email") for a in r.json()["admins"]]
        assert "TEST_admin@example.com" in emails

    def test_admin_callmebot_get(self, api, seeded_admin):
        r = api.get(f"{BASE_URL}/api/admin/callmebot",
                    headers=auth_headers(seeded_admin["token"]))
        assert r.status_code == 200
        body = r.json()
        assert "phone" in body and "apikey_set" in body
