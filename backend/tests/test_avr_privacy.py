# Tests for public Privacy Policy endpoints (Play Store compliance)
# - GET /api/privacy.html  (public HTML — the URL submitted to Google Play)
# - GET /api/privacy        (JSON)
# - GET /privacy            (internal top-level HTML)
# Privacy contact fields are now DYNAMIC — sourced from settings.key='support'
# (managed via PUT /api/admin/support). This file verifies that end-to-end:
#   admin saves → next GET of privacy endpoints reflects the new values.
# Also runs regression spot-checks against previously green endpoints.

import os
import re
import io
import json
import pytest
import requests

from conftest import auth_headers

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
# Internal backend URL — K8s ingress only routes /api/* externally, but `/privacy`
# (no /api prefix) is defined on the backend app and reachable internally.
INTERNAL_BACKEND_URL = "http://localhost:8001"

DEFAULT_SUPPORT_EMAIL = os.environ.get("SUPPORT_EMAIL", "support@herbalbloom.app")
DEFAULT_SUPPORT_WHATSAPP = os.environ.get("SUPPORT_WHATSAPP", "+919677337727")

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


# ----- Helpers -----
def _current_support(mongo):
    s = mongo.settings.find_one({"key": "support"}) or {}
    return {
        "email": s.get("email", DEFAULT_SUPPORT_EMAIL),
        "whatsapp": s.get("whatsapp", DEFAULT_SUPPORT_WHATSAPP),
    }


@pytest.fixture
def support_snapshot(mongo):
    """Snapshot the support settings doc, yield, then restore (prevents cross-test pollution)."""
    original = mongo.settings.find_one({"key": "support"})
    try:
        yield original
    finally:
        if original is None:
            mongo.settings.delete_many({"key": "support"})
        else:
            # pop _id to avoid immutable field errors on replace
            original.pop("_id", None)
            mongo.settings.replace_one({"key": "support"}, original, upsert=True)


# ---------- /api/privacy.html (HTML, public — Play Store URL) ----------
class TestPrivacyHtml:
    def test_html_status_and_content_type(self, api):
        r = api.get(f"{BASE_URL}/api/privacy.html")
        assert r.status_code == 200, r.text
        ctype = r.headers.get("content-type", "")
        assert "text/html" in ctype.lower(), f"content-type was {ctype!r}"

    def test_html_body_keywords(self, api, mongo):
        r = api.get(f"{BASE_URL}/api/privacy.html")
        body = r.text
        s = _current_support(mongo)
        assert "Privacy Policy" in body
        assert "AVR Organics" in body
        assert "Last updated" in body
        # must contain CURRENT admin-managed values, not a hardcoded placeholder
        assert s["email"] in body, f"HTML missing current support email {s['email']}"
        assert s["whatsapp"] in body, f"HTML missing current support whatsapp {s['whatsapp']}"

    def test_html_contains_all_9_sections(self, api):
        r = api.get(f"{BASE_URL}/api/privacy.html")
        body = r.text
        missing = [s for s in REQUIRED_SECTIONS if s not in body]
        assert not missing, f"Missing sections in HTML: {missing}"

    def test_html_no_auth_required(self):
        r = requests.get(f"{BASE_URL}/api/privacy.html", timeout=15)
        assert r.status_code == 200
        assert "Privacy Policy" in r.text


# ---------- /privacy (internal top-level HTML) ----------
class TestPrivacyRoot:
    def test_root_privacy_reflects_support_settings(self, mongo):
        """GET /privacy on the backend (internal route) reflects admin-managed values.
        K8s ingress only routes /api/* externally — this handler is reachable
        internally at localhost:8001/privacy."""
        try:
            r = requests.get(f"{INTERNAL_BACKEND_URL}/privacy", timeout=10)
        except requests.RequestException as e:
            pytest.skip(f"Internal backend not reachable: {e}")
        assert r.status_code == 200, r.text
        body = r.text
        s = _current_support(mongo)
        assert "Privacy Policy" in body
        assert s["email"] in body
        assert s["whatsapp"] in body


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

    def test_json_contact_matches_support_settings(self, api, mongo):
        """CORE: contact_email + contact_whatsapp must match current settings.key='support'."""
        data = api.get(f"{BASE_URL}/api/privacy").json()
        s = _current_support(mongo)
        assert data["contact_email"] == s["email"], \
            f"privacy email {data['contact_email']} != support settings {s['email']}"
        assert data["contact_whatsapp"] == s["whatsapp"], \
            f"privacy whatsapp {data['contact_whatsapp']} != support settings {s['whatsapp']}"

    def test_json_text_embeds_contact(self, api, mongo):
        data = api.get(f"{BASE_URL}/api/privacy").json()
        s = _current_support(mongo)
        text = data["text"]
        assert s["email"] in text
        assert s["whatsapp"] in text

    def test_json_text_contains_all_9_sections(self, api):
        data = api.get(f"{BASE_URL}/api/privacy").json()
        text = data["text"]
        missing = [s for s in REQUIRED_SECTIONS if s not in text]
        assert not missing, f"Missing sections in JSON text: {missing}"

    def test_json_no_auth_required(self):
        r = requests.get(f"{BASE_URL}/api/privacy", timeout=15)
        assert r.status_code == 200


# ---------- Dynamic flow: admin edit → privacy reflects new values ----------
class TestDynamicContactFlow:
    def test_put_support_updates_privacy_json(self, api, seeded_admin, support_snapshot):
        new_email = "TEST_privacy_dyn@example.com"
        new_wa = "+911111222233"
        r = api.put(
            f"{BASE_URL}/api/admin/support",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"email": new_email, "whatsapp": new_wa}),
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # next call must show new values
        data = api.get(f"{BASE_URL}/api/privacy").json()
        assert data["contact_email"] == new_email
        assert data["contact_whatsapp"] == new_wa
        assert new_email in data["text"]
        assert new_wa in data["text"]

    def test_put_support_updates_privacy_html(self, api, seeded_admin, support_snapshot):
        new_email = "TEST_privacy_html@example.com"
        new_wa = "+919000000111"
        r = api.put(
            f"{BASE_URL}/api/admin/support",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"email": new_email, "whatsapp": new_wa}),
        )
        assert r.status_code == 200, r.text

        html = api.get(f"{BASE_URL}/api/privacy.html").text
        assert new_email in html, "new email not injected into /api/privacy.html"
        assert new_wa in html, "new whatsapp not injected into /api/privacy.html"
        # mailto: link should also be updated
        assert f"mailto:{new_email}" in html

    def test_put_support_updates_root_privacy(self, api, seeded_admin, support_snapshot):
        new_email = "TEST_root_privacy@example.com"
        new_wa = "+919000000222"
        r = api.put(
            f"{BASE_URL}/api/admin/support",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"email": new_email, "whatsapp": new_wa}),
        )
        assert r.status_code == 200, r.text

        try:
            root = requests.get(f"{INTERNAL_BACKEND_URL}/privacy", timeout=10)
        except requests.RequestException as e:
            pytest.skip(f"Internal backend not reachable: {e}")
        assert root.status_code == 200
        html = root.text
        assert new_email in html
        assert new_wa in html

    def test_put_support_also_updates_support_info(self, api, seeded_admin, support_snapshot):
        """Regression: /api/support/info also reflects updated settings."""
        new_email = "TEST_support_info@example.com"
        new_wa = "+919000000333"
        r = api.put(
            f"{BASE_URL}/api/admin/support",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"email": new_email, "whatsapp": new_wa}),
        )
        assert r.status_code == 200
        info = api.get(f"{BASE_URL}/api/support/info").json()
        assert info["email"] == new_email
        assert info["whatsapp"] == new_wa
        # whatsapp_link should be built from the new number (digits only, no '+')
        assert info["whatsapp_link"].endswith(new_wa.replace("+", ""))

    def test_admin_support_requires_auth(self, api):
        r = api.put(
            f"{BASE_URL}/api/admin/support",
            data=json.dumps({"email": "x@x.com", "whatsapp": "+911111111111"}),
        )
        assert r.status_code in (401, 403)

    def test_admin_support_requires_admin_role(self, api, seeded_user):
        r = api.put(
            f"{BASE_URL}/api/admin/support",
            headers=auth_headers(seeded_user["token"]),
            data=json.dumps({"email": "x@x.com", "whatsapp": "+911111111111"}),
        )
        assert r.status_code == 403


# ---------- Fallback: no settings doc → env defaults, no crash ----------
class TestFallbackToEnvDefaults:
    def test_privacy_json_falls_back_to_env_defaults(self, api, mongo, support_snapshot):
        # Remove the support settings doc entirely
        mongo.settings.delete_many({"key": "support"})
        assert mongo.settings.find_one({"key": "support"}) is None

        r = api.get(f"{BASE_URL}/api/privacy")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["contact_email"] == DEFAULT_SUPPORT_EMAIL
        assert data["contact_whatsapp"] == DEFAULT_SUPPORT_WHATSAPP
        assert DEFAULT_SUPPORT_EMAIL in data["text"]

    def test_privacy_html_falls_back_to_env_defaults(self, api, mongo, support_snapshot):
        mongo.settings.delete_many({"key": "support"})
        r = api.get(f"{BASE_URL}/api/privacy.html")
        assert r.status_code == 200, r.text
        assert DEFAULT_SUPPORT_EMAIL in r.text
        assert DEFAULT_SUPPORT_WHATSAPP in r.text


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
        r = api.get(f"{BASE_URL}/api/products/p_ashwagandha")
        assert r.status_code == 200
        assert r.json()["product"]["id"] == "p_ashwagandha"

    def test_pricelist_public(self, api):
        r = api.get(f"{BASE_URL}/api/pricelist")
        assert r.status_code == 200
        body = r.json()
        assert "images" in body and isinstance(body["images"], list)

    def test_orders_me(self, api, seeded_user):
        r = api.get(f"{BASE_URL}/api/orders/me", headers=auth_headers(seeded_user["token"]))
        assert r.status_code == 200
        assert "orders" in r.json()

    def test_delete_account_requires_auth(self, api):
        r = api.delete(f"{BASE_URL}/api/auth/account")
        assert r.status_code in (401, 403)

    def test_cancel_order_not_found(self, api, seeded_user):
        r = api.post(
            f"{BASE_URL}/api/orders/does_not_exist_TEST/cancel",
            headers=auth_headers(seeded_user["token"]),
        )
        assert r.status_code == 404

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
        emails = [a.get("email") for a in r.json()["admins"]]
        assert "TEST_admin@example.com" in emails
