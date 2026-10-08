# Tests for the NEW Promo Coupon system.
#
# Endpoints under test:
#   - POST   /api/coupons/validate              (public)
#   - GET    /api/admin/coupons                 (admin)
#   - POST   /api/admin/coupons                 (admin)
#   - PATCH  /api/admin/coupons/{coupon_id}     (admin)
#   - DELETE /api/admin/coupons/{coupon_id}     (admin)
#   - POST   /api/orders/create                 (now accepts optional coupon_code)
#
# Mongo collection: coupons
# Scope: BACKEND ONLY. All TEST_ coupons are cleaned up at session teardown.

import os
import json
import uuid
import pytest
import requests

from conftest import auth_headers

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

# All coupon codes created by this suite are prefixed so cleanup is safe.
TEST_PREFIX = "TEST"


# ---------- Shared helpers ----------
def _unique_code(tag: str) -> str:
    """Generate a unique uppercase TEST_* coupon code per test."""
    return f"{TEST_PREFIX}{tag.upper()}{uuid.uuid4().hex[:6].upper()}"


@pytest.fixture(autouse=True)
def _cleanup_coupons(mongo):
    """Delete any TEST_* coupons after each test. Keeps DB clean."""
    yield
    mongo.coupons.delete_many({"code": {"$regex": f"^{TEST_PREFIX}"}})


@pytest.fixture(scope="session", autouse=True)
def _final_coupon_sweep(mongo):
    """Final sweep at end of session (defensive)."""
    yield
    mongo.coupons.delete_many({"code": {"$regex": f"^{TEST_PREFIX}"}})


# A dedicated product with a stable price we fully control.
# NOTE: we insert directly into Mongo because the live seed product
# `p_ashwagandha` has been mutated by prior admin-edit test runs
# (price/name reflect user edits — see /api/products/p_ashwagandha).
TEST_PRODUCT_ID = "p_TEST_coupon_500"
TEST_PRODUCT_PRICE = 500.0


@pytest.fixture(scope="session", autouse=True)
def _seed_test_product(mongo):
    mongo.products.delete_many({"id": TEST_PRODUCT_ID})
    mongo.products.insert_one({
        "id": TEST_PRODUCT_ID,
        "name": "TEST Coupon Product",
        "tagline": "test fixture",
        "description": "Fixture product with a stable ₹500 price for coupon tests.",
        "price": TEST_PRODUCT_PRICE,
        "image": "",
        "category": "TEST",
        "benefits": [],
        "ingredients": [],
        "in_stock": True,
    })
    yield
    mongo.products.delete_many({"id": TEST_PRODUCT_ID})


def _create_coupon(api, admin_token, **overrides):
    """Create a TEST_ coupon with sensible defaults; returns parsed response."""
    payload = {
        "code": overrides.pop("code", _unique_code("C")),
        "discount_type": "percent",
        "discount_value": 10,
        "min_order_value": 0,
        "active": True,
    }
    payload.update(overrides)
    r = api.post(
        f"{BASE_URL}/api/admin/coupons",
        headers=auth_headers(admin_token),
        data=json.dumps(payload),
    )
    return r


# ============================================================
# A. Admin auth gating on /api/admin/coupons*
# ============================================================
class TestAdminCouponsAuthGating:
    def test_list_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/admin/coupons")
        assert r.status_code in (401, 403), r.text

    def test_create_requires_auth(self, api):
        r = api.post(
            f"{BASE_URL}/api/admin/coupons",
            data=json.dumps({"code": _unique_code("A"), "discount_type": "percent", "discount_value": 10}),
        )
        assert r.status_code in (401, 403), r.text

    def test_patch_requires_auth(self, api):
        r = api.patch(
            f"{BASE_URL}/api/admin/coupons/cp_doesnotexist",
            data=json.dumps({"active": False}),
        )
        assert r.status_code in (401, 403), r.text

    def test_delete_requires_auth(self, api):
        r = api.delete(f"{BASE_URL}/api/admin/coupons/cp_doesnotexist")
        assert r.status_code in (401, 403), r.text

    def test_list_rejects_non_admin(self, api, seeded_user):
        r = api.get(f"{BASE_URL}/api/admin/coupons", headers=auth_headers(seeded_user["token"]))
        assert r.status_code == 403, r.text

    def test_create_rejects_non_admin(self, api, seeded_user):
        r = api.post(
            f"{BASE_URL}/api/admin/coupons",
            headers=auth_headers(seeded_user["token"]),
            data=json.dumps({"code": _unique_code("A"), "discount_type": "percent", "discount_value": 10}),
        )
        assert r.status_code == 403, r.text


# ============================================================
# B. Create validations
# ============================================================
class TestCreateCouponValidations:
    def test_missing_code_rejected(self, api, seeded_admin):
        r = _create_coupon(api, seeded_admin["token"], code="")
        assert r.status_code == 400, r.text

    def test_whitespace_code_rejected(self, api, seeded_admin):
        r = _create_coupon(api, seeded_admin["token"], code="   ")
        assert r.status_code == 400, r.text

    def test_bad_discount_type_rejected(self, api, seeded_admin):
        r = _create_coupon(api, seeded_admin["token"], discount_type="freebie", discount_value=10)
        assert r.status_code == 400, r.text

    def test_zero_discount_value_rejected(self, api, seeded_admin):
        r = _create_coupon(api, seeded_admin["token"], discount_value=0)
        assert r.status_code == 400, r.text

    def test_negative_discount_value_rejected(self, api, seeded_admin):
        r = _create_coupon(api, seeded_admin["token"], discount_value=-5)
        assert r.status_code == 400, r.text

    def test_percent_over_100_rejected(self, api, seeded_admin):
        r = _create_coupon(api, seeded_admin["token"], discount_type="percent", discount_value=150)
        assert r.status_code == 400, r.text

    def test_duplicate_code_case_insensitive(self, api, seeded_admin):
        base = _unique_code("DUP")
        r1 = _create_coupon(api, seeded_admin["token"], code=base.lower(), discount_type="percent", discount_value=10)
        assert r1.status_code == 200, r1.text
        # Attempt duplicate with different casing
        r2 = _create_coupon(api, seeded_admin["token"], code=base.swapcase(), discount_type="flat", discount_value=50)
        assert r2.status_code == 409, r2.text

    def test_valid_percent_creates_with_uppercase_code(self, api, seeded_admin):
        raw = _unique_code("Pct").lower()  # mixed-case input
        r = _create_coupon(api, seeded_admin["token"], code=raw, discount_type="percent", discount_value=15)
        assert r.status_code == 200, r.text
        c = r.json()["coupon"]
        assert c["code"] == raw.upper()
        assert c["discount_type"] == "percent"
        assert c["discount_value"] == 15
        assert c["active"] is True
        assert c["used_count"] == 0
        assert c["id"].startswith("cp_")
        assert "created_at" in c

    def test_valid_flat_creates(self, api, seeded_admin):
        code = _unique_code("Flat")
        r = _create_coupon(api, seeded_admin["token"], code=code, discount_type="flat", discount_value=50, min_order_value=200)
        assert r.status_code == 200, r.text
        c = r.json()["coupon"]
        assert c["discount_type"] == "flat"
        assert c["discount_value"] == 50
        assert c["min_order_value"] == 200


# ============================================================
# C. List returns newest-first + full fields
# ============================================================
class TestListCoupons:
    def test_list_newest_first_and_fields(self, api, seeded_admin):
        a = _create_coupon(api, seeded_admin["token"], code=_unique_code("L1"), discount_type="percent", discount_value=10).json()["coupon"]
        b = _create_coupon(api, seeded_admin["token"], code=_unique_code("L2"), discount_type="flat", discount_value=25).json()["coupon"]

        r = api.get(f"{BASE_URL}/api/admin/coupons", headers=auth_headers(seeded_admin["token"]))
        assert r.status_code == 200, r.text
        coupons = r.json()["coupons"]
        assert isinstance(coupons, list)

        test_ones = [c for c in coupons if c["code"].startswith(TEST_PREFIX)]
        # Both created ones must appear
        codes = [c["code"] for c in test_ones]
        assert a["code"] in codes and b["code"] in codes

        # Newest-first: find positions of a (older) and b (newer)
        pos_a = next(i for i, c in enumerate(coupons) if c["code"] == a["code"])
        pos_b = next(i for i, c in enumerate(coupons) if c["code"] == b["code"])
        assert pos_b < pos_a, "Newest coupon should appear before older coupon"

        # Each entry must expose all required public fields
        required = {"id", "code", "discount_type", "discount_value", "min_order_value",
                    "expires_at", "active", "used_count", "created_at"}
        for c in test_ones:
            assert required.issubset(c.keys()), f"missing fields: {required - set(c.keys())}"


# ============================================================
# D. Public /api/coupons/validate
# ============================================================
class TestValidateCoupon:
    def test_invalid_code(self, api):
        r = api.post(f"{BASE_URL}/api/coupons/validate",
                     data=json.dumps({"code": "TEST_NOSUCH_" + uuid.uuid4().hex[:6], "subtotal": 500}))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["valid"] is False
        assert body["error"] == "Invalid coupon code"

    def test_inactive_coupon(self, api, seeded_admin):
        code = _unique_code("INAC")
        c = _create_coupon(api, seeded_admin["token"], code=code, discount_type="percent", discount_value=10, active=False).json()["coupon"]
        r = api.post(f"{BASE_URL}/api/coupons/validate",
                     data=json.dumps({"code": c["code"], "subtotal": 500}))
        body = r.json()
        assert body["valid"] is False
        assert "inactive" in body["error"].lower()

    def test_expired_coupon_via_patch(self, api, seeded_admin):
        c = _create_coupon(api, seeded_admin["token"], code=_unique_code("EXP"), discount_type="percent", discount_value=10).json()["coupon"]
        # PATCH expires_at to a past date
        r_p = api.patch(
            f"{BASE_URL}/api/admin/coupons/{c['id']}",
            headers=auth_headers(seeded_admin["token"]),
            data=json.dumps({"expires_at": "2020-01-01"}),
        )
        assert r_p.status_code == 200, r_p.text

        r = api.post(f"{BASE_URL}/api/coupons/validate",
                     data=json.dumps({"code": c["code"], "subtotal": 1000}))
        body = r.json()
        assert body["valid"] is False
        assert "expired" in body["error"].lower()

    def test_min_order_value_not_met(self, api, seeded_admin):
        c = _create_coupon(api, seeded_admin["token"], code=_unique_code("MIN"),
                           discount_type="flat", discount_value=50, min_order_value=500).json()["coupon"]
        r = api.post(f"{BASE_URL}/api/coupons/validate",
                     data=json.dumps({"code": c["code"], "subtotal": 100}))
        body = r.json()
        assert body["valid"] is False
        assert "500" in body["error"] or "minimum" in body["error"].lower()

    def test_valid_percent_10_on_1000(self, api, seeded_admin):
        c = _create_coupon(api, seeded_admin["token"], code=_unique_code("PCT"),
                           discount_type="percent", discount_value=10).json()["coupon"]
        r = api.post(f"{BASE_URL}/api/coupons/validate",
                     data=json.dumps({"code": c["code"], "subtotal": 1000}))
        body = r.json()
        assert body["valid"] is True, body
        assert body["code"] == c["code"]
        assert body["discount_type"] == "percent"
        assert body["discount"] == 100
        assert body["final"] == 900

    def test_valid_flat_50_on_1000(self, api, seeded_admin):
        c = _create_coupon(api, seeded_admin["token"], code=_unique_code("FLAT"),
                           discount_type="flat", discount_value=50).json()["coupon"]
        r = api.post(f"{BASE_URL}/api/coupons/validate",
                     data=json.dumps({"code": c["code"], "subtotal": 1000}))
        body = r.json()
        assert body["valid"] is True, body
        assert body["discount"] == 50
        assert body["final"] == 950

    def test_flat_discount_clamped_at_subtotal(self, api, seeded_admin):
        c = _create_coupon(api, seeded_admin["token"], code=_unique_code("CLAMP"),
                           discount_type="flat", discount_value=500).json()["coupon"]
        r = api.post(f"{BASE_URL}/api/coupons/validate",
                     data=json.dumps({"code": c["code"], "subtotal": 300}))
        body = r.json()
        assert body["valid"] is True, body
        assert body["discount"] == 300
        assert body["final"] == 0

    def test_validate_is_case_insensitive(self, api, seeded_admin):
        code = _unique_code("CI")
        _create_coupon(api, seeded_admin["token"], code=code, discount_type="percent", discount_value=10)
        r = api.post(f"{BASE_URL}/api/coupons/validate",
                     data=json.dumps({"code": code.lower(), "subtotal": 1000}))
        body = r.json()
        assert body["valid"] is True
        assert body["code"] == code.upper()


# ============================================================
# E. Order creation with coupon
# ============================================================
class TestOrderWithCoupon:
    def _seed_cart_above_999(self, api, token):
        """3 units of TEST product @500 = ₹1500 subtotal."""
        h = auth_headers(token)
        api.post(f"{BASE_URL}/api/cart/clear", headers=h)
        api.post(f"{BASE_URL}/api/cart/update",
                 json={"product_id": TEST_PRODUCT_ID, "quantity": 3}, headers=h)
        return 3 * TEST_PRODUCT_PRICE  # 1500.0

    def _seed_cart_below_999(self, api, token):
        """1 unit of TEST product @500 = ₹500 subtotal (below free-shipping threshold)."""
        h = auth_headers(token)
        api.post(f"{BASE_URL}/api/cart/clear", headers=h)
        api.post(f"{BASE_URL}/api/cart/update",
                 json={"product_id": TEST_PRODUCT_ID, "quantity": 1}, headers=h)
        return TEST_PRODUCT_PRICE  # 500.0

    @staticmethod
    def _addr():
        return {
            "full_name": "TEST User", "phone": "9999999999",
            "line1": "1 Test St", "city": "Chennai",
            "state": "TN", "pincode": "600001",
        }

    def test_order_with_valid_percent_coupon_free_shipping(self, api, seeded_user, seeded_admin, mongo):
        subtotal = self._seed_cart_above_999(api, seeded_user["token"])  # 1497
        code = _unique_code("ORDPCT")
        c = _create_coupon(api, seeded_admin["token"], code=code,
                           discount_type="percent", discount_value=10).json()["coupon"]

        h = auth_headers(seeded_user["token"])
        r = api.post(f"{BASE_URL}/api/orders/create",
                     data=json.dumps({"address": self._addr(), "payment_method": "razorpay",
                                      "coupon_code": code.lower()}),
                     headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        expected_discount = round(subtotal * 0.1, 2)  # 149.7
        expected_discounted = round(subtotal - expected_discount, 2)  # 1347.3
        expected_shipping = 0.0  # > 999
        expected_total = round(expected_discounted + expected_shipping, 2)
        assert body["total"] == expected_total

        # Fetch stored order
        order_id = body["order_id"]
        g = api.get(f"{BASE_URL}/api/orders/{order_id}", headers=h)
        assert g.status_code == 200, g.text
        order = g.json()["order"]
        assert order["subtotal"] == round(subtotal, 2)
        assert order["discount"] == expected_discount
        assert order["shipping"] == expected_shipping
        assert order["total"] == expected_total
        assert order["coupon_code"] == code.upper()

        # Mongo: used_count must have incremented
        doc = mongo.coupons.find_one({"id": c["id"]})
        assert doc is not None
        assert int(doc.get("used_count", 0)) == 1

    def test_order_with_valid_coupon_paid_shipping(self, api, seeded_user, seeded_admin):
        """Discount drops subtotal below ₹999 → ₹49 shipping applies on the DISCOUNTED subtotal."""
        subtotal = self._seed_cart_below_999(api, seeded_user["token"])  # 499
        code = _unique_code("ORDLOW")
        _create_coupon(api, seeded_admin["token"], code=code,
                       discount_type="flat", discount_value=50)

        h = auth_headers(seeded_user["token"])
        r = api.post(f"{BASE_URL}/api/orders/create",
                     data=json.dumps({"address": self._addr(), "payment_method": "razorpay",
                                      "coupon_code": code}),
                     headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        expected_discount = 50.0
        expected_discounted = round(subtotal - expected_discount, 2)  # 449
        expected_shipping = 49.0  # <= 999
        expected_total = round(expected_discounted + expected_shipping, 2)  # 498
        assert body["total"] == expected_total, (body, expected_total)

        order = api.get(f"{BASE_URL}/api/orders/{body['order_id']}", headers=h).json()["order"]
        assert order["subtotal"] == round(subtotal, 2)
        assert order["discount"] == expected_discount
        assert order["shipping"] == expected_shipping
        assert order["coupon_code"] == code.upper()

    def test_order_with_invalid_coupon_rejected(self, api, seeded_user, mongo):
        self._seed_cart_above_999(api, seeded_user["token"])
        orders_before = mongo.orders.count_documents({"user_id": seeded_user["user_id"]})

        h = auth_headers(seeded_user["token"])
        r = api.post(f"{BASE_URL}/api/orders/create",
                     data=json.dumps({"address": self._addr(), "payment_method": "razorpay",
                                      "coupon_code": "TEST_NOSUCH_" + uuid.uuid4().hex[:6]}),
                     headers=h)
        assert r.status_code == 400, r.text

        orders_after = mongo.orders.count_documents({"user_id": seeded_user["user_id"]})
        assert orders_after == orders_before, "Order must NOT be created when coupon invalid"

    def test_order_with_expired_coupon_rejected(self, api, seeded_user, seeded_admin, mongo):
        self._seed_cart_above_999(api, seeded_user["token"])
        code = _unique_code("ORDEXP")
        c = _create_coupon(api, seeded_admin["token"], code=code,
                           discount_type="percent", discount_value=10).json()["coupon"]
        # expire it
        api.patch(f"{BASE_URL}/api/admin/coupons/{c['id']}",
                  headers=auth_headers(seeded_admin["token"]),
                  data=json.dumps({"expires_at": "2020-01-01"}))

        orders_before = mongo.orders.count_documents({"user_id": seeded_user["user_id"]})
        h = auth_headers(seeded_user["token"])
        r = api.post(f"{BASE_URL}/api/orders/create",
                     data=json.dumps({"address": self._addr(), "payment_method": "razorpay",
                                      "coupon_code": code}),
                     headers=h)
        assert r.status_code == 400, r.text
        orders_after = mongo.orders.count_documents({"user_id": seeded_user["user_id"]})
        assert orders_after == orders_before

        # used_count must NOT have been bumped
        doc = mongo.coupons.find_one({"id": c["id"]})
        assert int(doc.get("used_count", 0)) == 0

    def test_order_without_coupon_unaffected(self, api, seeded_user):
        self._seed_cart_above_999(api, seeded_user["token"])
        h = auth_headers(seeded_user["token"])
        r = api.post(f"{BASE_URL}/api/orders/create",
                     data=json.dumps({"address": self._addr(), "payment_method": "razorpay"}),
                     headers=h)
        assert r.status_code == 200, r.text
        order = api.get(f"{BASE_URL}/api/orders/{r.json()['order_id']}", headers=h).json()["order"]
        # No coupon => coupon_code falsy, discount 0
        assert not order.get("coupon_code")
        assert float(order.get("discount", 0)) == 0.0
        # Shipping should be free since subtotal 1497 > 999
        assert order["shipping"] == 0.0
        assert order["total"] == order["subtotal"]


# ============================================================
# F. Update + delete
# ============================================================
class TestUpdateAndDeleteCoupon:
    def test_patch_active_false_then_validate_inactive(self, api, seeded_admin):
        c = _create_coupon(api, seeded_admin["token"], code=_unique_code("TOG"),
                           discount_type="percent", discount_value=10).json()["coupon"]
        r_p = api.patch(f"{BASE_URL}/api/admin/coupons/{c['id']}",
                        headers=auth_headers(seeded_admin["token"]),
                        data=json.dumps({"active": False}))
        assert r_p.status_code == 200, r_p.text
        assert r_p.json()["coupon"]["active"] is False

        v = api.post(f"{BASE_URL}/api/coupons/validate",
                     data=json.dumps({"code": c["code"], "subtotal": 1000})).json()
        assert v["valid"] is False
        assert "inactive" in v["error"].lower()

    def test_patch_expires_at_empty_clears(self, api, seeded_admin):
        c = _create_coupon(api, seeded_admin["token"], code=_unique_code("CLR"),
                           discount_type="percent", discount_value=10,
                           expires_at="2099-12-31").json()["coupon"]
        assert c["expires_at"] is not None

        r_p = api.patch(f"{BASE_URL}/api/admin/coupons/{c['id']}",
                        headers=auth_headers(seeded_admin["token"]),
                        data=json.dumps({"expires_at": ""}))
        assert r_p.status_code == 200, r_p.text
        assert r_p.json()["coupon"]["expires_at"] in (None, ""), r_p.json()

        # Still works (not expired)
        v = api.post(f"{BASE_URL}/api/coupons/validate",
                     data=json.dumps({"code": c["code"], "subtotal": 1000})).json()
        assert v["valid"] is True

    def test_patch_percent_over_100_rejected(self, api, seeded_admin):
        c = _create_coupon(api, seeded_admin["token"], code=_unique_code("P100"),
                           discount_type="percent", discount_value=10).json()["coupon"]
        r_p = api.patch(f"{BASE_URL}/api/admin/coupons/{c['id']}",
                        headers=auth_headers(seeded_admin["token"]),
                        data=json.dumps({"discount_value": 150}))
        assert r_p.status_code == 400, r_p.text

    def test_delete_nonexistent_404(self, api, seeded_admin):
        r = api.delete(f"{BASE_URL}/api/admin/coupons/cp_doesnotexist_{uuid.uuid4().hex[:6]}",
                       headers=auth_headers(seeded_admin["token"]))
        assert r.status_code == 404, r.text

    def test_delete_existing_removes_from_list(self, api, seeded_admin):
        c = _create_coupon(api, seeded_admin["token"], code=_unique_code("DEL"),
                           discount_type="percent", discount_value=10).json()["coupon"]
        r = api.delete(f"{BASE_URL}/api/admin/coupons/{c['id']}",
                       headers=auth_headers(seeded_admin["token"]))
        assert r.status_code == 200, r.text

        listed = api.get(f"{BASE_URL}/api/admin/coupons",
                         headers=auth_headers(seeded_admin["token"])).json()["coupons"]
        assert all(x["id"] != c["id"] for x in listed), "deleted coupon still appears"
