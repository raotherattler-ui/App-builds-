# Tests for the NEW dedicated Privacy Policy contact feature.
# Backend keeps privacy contact (email + whatsapp) under settings.key='privacy_contact',
# independent from Customer Support (settings.key='support').
#
# Endpoints under test:
#   - GET  /api/admin/privacy/contact   (admin only)
#   - PUT  /api/admin/privacy/contact   (admin only)
#   - GET  /api/privacy                 (JSON — must reflect privacy_contact if set, else fall back to support)
#   - GET  /api/privacy.html            (HTML — same contract)
# Regression sanity:
#   - GET  /api/support/info            (must NOT be affected by privacy_contact changes)

import os
import json
import pytest
import requests

from conftest import auth_headers

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


# ----- Shared fixture: snapshot & restore both settings docs -----
@pytest.fixture
def settings_snapshot(mongo):
    """Snapshot support + privacy_contact settings docs; restore after test."""
    before_support = mongo.settings.find_one({"key": "support"})
    before_privacy = mongo.settings.find_one({"key": "privacy_contact"})
    try:
        yield
    finally:
        # Restore support
        if before_support is None:
            mongo.settings.delete_many({"key": "support"})
        else:
            before_support.pop("_id", None)
            mongo.settings.replace_one({"key": "support"}, before_support, upsert=True)
        # Restore privacy_contact
        if before_privacy is None:
            mongo.settings.delete_many({"key": "privacy_contact"})
        else:
            before_privacy.pop("_id", None)
            mongo.settings.replace_one({"key": "privacy_contact"}, before_privacy, upsert=True)


# ============================================================
# A. Fallback behavior (no privacy_contact set)
# ============================================================
class TestFallbackWhenPrivacyContactUnset:
    def test_privacy_falls_back_to_support_when_unset(self, api, mongo, settings_snapshot):
        # ensure privacy_contact is absent
        mongo.settings.delete_many({"key": "privacy_contact"})
        assert mongo.settings.find_one({"key": "privacy_contact"}) is None

        support = api.get(f"{BASE_URL}/api/support/info").json()
        privacy = api.get(f"{BASE_URL}/api/privacy").json()

        assert privacy["contact_email"] == support["email"], (
            f"privacy email {privacy['contact_email']!r} != support email {support['email']!r}"
        )
        assert privacy["contact_whatsapp"] == support["whatsapp"], (
            f"privacy whatsapp {privacy['contact_whatsapp']!r} != support whatsapp {support['whatsapp']!r}"
        )

    def test_privacy_html_falls_back_to_support_when_unset(self, api, mongo, settings_snapshot):
        mongo.settings.delete_many({"key": "privacy_contact"})

        support = api.get(f"{BASE_URL}/api/support/info").json()
        html = api.get(f"{BASE_URL}/api/privacy.html").text

        assert support["email"] in html
        assert support["whatsapp"] in html


# ============================================================
# B. Admin auth required on /api/admin/privacy/contact
# ============================================================
class TestAdminPrivacyContactAuthGating:
    def test_get_requires_auth_header(self, api):
        r = api.get(f"{BASE_URL}/api/admin/privacy/contact")
        assert r.status_code in (401, 403), r.text

    def test_put_requires_auth_header(self, api):
        r = api.put(
            f"{BASE_URL}/api/admin/privacy/contact",
            data=json.dumps({"email": "x@x.com", "whatsapp": "+911111111111"}),
        )
        assert r.status_code in (401, 403), r.text

    def test_get_rejects_non_admin(self, api, seeded_user):
        r = api.get(
            f"{BASE_URL}/api/admin/privacy/contact",
            headers=auth_headers(seeded_user["token"]),
        )
        assert r.status_code == 403, r.text

    def test_put_rejects_non_admin(self, api, seeded_user):
        r = api.put(
            f"{BASE_URL}/api/admin/privacy/contact",
            headers=auth_headers(seeded_user["token"]),
            data=json.dumps({"email": "x@x.com", "whatsapp": "+911111111111"}),
        )
        assert r.status_code == 403, r.text

    def test_get_rejects_bogus_bearer(self, api):
        r = api.get(
            f"{BASE_URL}/api/admin/privacy/contact",
            headers=auth_headers("bogus_token_TEST"),
        )
        assert r.status_code in (401, 403), r.text


# ============================================================
# C. Set + fetch (admin round-trip; isolation from support)
# ============================================================
class TestSetAndFetchPrivacyContact:
    def test_put_then_get_roundtrip_and_privacy_reflects(self, api, seeded_admin, settings_snapshot):
        new_email = "privacy@avr.test"
        new_wa = "+911234567890"

        # Capture support BEFORE so we can prove it's untouched later
        support_before = api.get(f"{BASE_URL}/api/support/info").json()

        # 1) PUT /api/admin/privacy/contact
        r = api.put(
            f"{BASE_URL}/api/admin/privacy/contact",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"email": new_email, "whatsapp": new_wa}),
        )
        assert r.status_code == 200, r.text
        put_body = r.json()
        assert put_body.get("ok") is True
        assert put_body.get("email") == new_email
        assert put_body.get("whatsapp") == new_wa

        # 2) GET /api/admin/privacy/contact — same values
        r2 = api.get(
            f"{BASE_URL}/api/admin/privacy/contact",
            headers=auth_headers(seeded_admin["token"]),
        )
        assert r2.status_code == 200, r2.text
        got = r2.json()
        assert got.get("email") == new_email
        assert got.get("whatsapp") == new_wa

        # 3) /api/privacy now uses the dedicated contact
        priv = api.get(f"{BASE_URL}/api/privacy").json()
        assert priv["contact_email"] == new_email
        assert priv["contact_whatsapp"] == new_wa
        # And NOT the support email (unless they happen to match — guard both)
        if support_before["email"] != new_email:
            assert priv["contact_email"] != support_before["email"]

        # 4) HTML renders the dedicated contact
        html = api.get(f"{BASE_URL}/api/privacy.html").text
        assert new_email in html
        assert new_wa in html
        assert f"mailto:{new_email}" in html, "mailto: anchor was not rebuilt with privacy email"

        # 5) /api/support/info is UNCHANGED
        support_after = api.get(f"{BASE_URL}/api/support/info").json()
        assert support_after["email"] == support_before["email"], (
            "Support email changed when only privacy_contact was PUT"
        )
        assert support_after["whatsapp"] == support_before["whatsapp"], (
            "Support whatsapp changed when only privacy_contact was PUT"
        )


# ============================================================
# D. Updating support must NOT clobber privacy once set
# ============================================================
class TestSupportUpdateDoesNotAffectPrivacy:
    def test_support_put_does_not_change_privacy(self, api, seeded_admin, settings_snapshot):
        # Lock a known privacy contact first
        priv_email = "privacy@avr.test"
        priv_wa = "+911234567890"
        r = api.put(
            f"{BASE_URL}/api/admin/privacy/contact",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"email": priv_email, "whatsapp": priv_wa}),
        )
        assert r.status_code == 200, r.text

        # Now update support to something clearly different
        new_support_email = "TEST_newsupport@example.com"
        new_support_wa = "+919988776655"
        rs = api.put(
            f"{BASE_URL}/api/admin/support",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"email": new_support_email, "whatsapp": new_support_wa}),
        )
        assert rs.status_code == 200, rs.text

        # Verify support actually changed
        support = api.get(f"{BASE_URL}/api/support/info").json()
        assert support["email"] == new_support_email
        assert support["whatsapp"] == new_support_wa

        # Privacy must STILL show privacy_contact values, not the new support values
        priv = api.get(f"{BASE_URL}/api/privacy").json()
        assert priv["contact_email"] == priv_email
        assert priv["contact_whatsapp"] == priv_wa
        assert priv["contact_email"] != new_support_email
        assert priv["contact_whatsapp"] != new_support_wa

        html = api.get(f"{BASE_URL}/api/privacy.html").text
        assert priv_email in html
        assert priv_wa in html
        assert new_support_email not in html, "Privacy HTML leaked the new support email"


# ============================================================
# E. Partial clear → fall back to support
# ============================================================
class TestClearPrivacyFallsBack:
    def test_empty_strings_cause_fallback_to_support(self, api, seeded_admin, settings_snapshot):
        # Set a dedicated privacy contact first
        r = api.put(
            f"{BASE_URL}/api/admin/privacy/contact",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"email": "privacy@avr.test", "whatsapp": "+911234567890"}),
        )
        assert r.status_code == 200, r.text

        # Also set a known support value so fallback is unambiguous
        support_email = "TEST_support_for_fallback@example.com"
        support_wa = "+917000000111"
        rs = api.put(
            f"{BASE_URL}/api/admin/support",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"email": support_email, "whatsapp": support_wa}),
        )
        assert rs.status_code == 200, rs.text

        # Now CLEAR privacy_contact (both empty)
        rc = api.put(
            f"{BASE_URL}/api/admin/privacy/contact",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"email": "", "whatsapp": ""}),
        )
        assert rc.status_code == 200, rc.text
        # PUT response should reflect the fallback values too (helper returns fallback when both empty)
        pb = rc.json()
        assert pb.get("ok") is True
        assert pb.get("email") == support_email, (
            f"After clear, PUT should return fallback support email; got {pb.get('email')!r}"
        )
        assert pb.get("whatsapp") == support_wa, (
            f"After clear, PUT should return fallback support whatsapp; got {pb.get('whatsapp')!r}"
        )

        # /api/privacy falls back to the current support contact
        priv = api.get(f"{BASE_URL}/api/privacy").json()
        assert priv["contact_email"] == support_email
        assert priv["contact_whatsapp"] == support_wa

        # /api/privacy.html too
        html = api.get(f"{BASE_URL}/api/privacy.html").text
        assert support_email in html
        assert support_wa in html


# ============================================================
# Sanity: /api/support/info and /api/privacy.html still work
# ============================================================
class TestSanity:
    def test_support_info_shape(self, api):
        r = api.get(f"{BASE_URL}/api/support/info")
        assert r.status_code == 200
        for k in ("email", "whatsapp", "whatsapp_link"):
            assert k in r.json()

    def test_privacy_html_200_html(self, api):
        r = api.get(f"{BASE_URL}/api/privacy.html")
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "").lower()
        assert "Privacy Policy" in r.text
