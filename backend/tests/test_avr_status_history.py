"""Iteration 6: Order Status Tracking (status_history timeline).

Covers:
- POST /api/orders/create — new order has status_history [{status: 'pending', note: 'Order placed', at: iso}]
- GET /api/orders/me — status_history serialized (iso strings)
- GET /api/orders/{order_id} — status_history serialized
- PUT /api/admin/orders/{order_id}/status — appends new entry (status + note + by + at)
- GET /api/admin/orders/{order_id} — new admin endpoint
- POST /api/orders/{order_id}/mock-pay — appends 'paid' event
- Status transitions pending -> paid -> shipped -> delivered update history correctly
- Backfill: legacy orders without status_history get populated at startup
"""
import os
import uuid
from datetime import datetime, timezone

import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _is_iso_string(v) -> bool:
    if not isinstance(v, str):
        return False
    try:
        # Python's fromisoformat accepts the format we emit (datetime.isoformat())
        datetime.fromisoformat(v.replace("Z", "+00:00"))
        return True
    except Exception:
        return False


def _create_order(api, token, product_id="p_ashwagandha", method="upi"):
    h = _h(token)
    api.post(f"{BASE_URL}/api/cart/clear", headers=h)
    api.post(f"{BASE_URL}/api/cart/add",
             json={"product_id": product_id, "quantity": 1}, headers=h)
    addr = {
        "full_name": "TEST StatusHistory", "phone": "9999999999",
        "line1": "1 Test St", "city": "Chennai",
        "state": "TN", "pincode": "600001",
    }
    r = api.post(f"{BASE_URL}/api/orders/create",
                 json={"address": addr, "payment_method": method}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Create order -> initial status_history ----------
class TestOrderCreateHistory:
    def test_create_order_initial_status_history(self, api, seeded_user):
        d = _create_order(api, seeded_user["token"], method="upi")
        oid = d["order_id"]

        r = api.get(f"{BASE_URL}/api/orders/{oid}", headers=_h(seeded_user["token"]))
        assert r.status_code == 200, r.text
        order = r.json()["order"]

        assert "status_history" in order, "status_history missing on freshly created order"
        hist = order["status_history"]
        assert isinstance(hist, list) and len(hist) == 1, f"expected exactly 1 entry, got {hist}"
        entry = hist[0]
        assert entry["status"] == "pending", entry
        assert entry["note"] == "Order placed", entry
        assert _is_iso_string(entry.get("at")), f"'at' must be ISO string, got {entry.get('at')!r}"

    def test_orders_me_includes_serialized_history(self, api, seeded_user):
        d = _create_order(api, seeded_user["token"], method="upi")
        r = api.get(f"{BASE_URL}/api/orders/me", headers=_h(seeded_user["token"]))
        assert r.status_code == 200
        orders = r.json()["orders"]
        match = [o for o in orders if o["id"] == d["order_id"]]
        assert match, "created order not found in /orders/me"
        o = match[0]
        assert isinstance(o.get("status_history"), list) and len(o["status_history"]) >= 1
        for h in o["status_history"]:
            assert _is_iso_string(h.get("at")), f"'at' not ISO: {h.get('at')!r}"


# ---------- Admin status update appends history ----------
class TestAdminStatusHistory:
    def test_admin_status_update_appends_entries_with_by(self, api, seeded_admin, seeded_user):
        d = _create_order(api, seeded_user["token"], method="upi")
        oid = d["order_id"]
        admin_h = _h(seeded_admin["token"])

        for status in ("paid", "shipped", "delivered"):
            r = api.put(f"{BASE_URL}/api/admin/orders/{oid}/status",
                        json={"status": status}, headers=admin_h)
            assert r.status_code == 200, r.text

        # Fetch via admin endpoint (new)
        r = api.get(f"{BASE_URL}/api/admin/orders/{oid}", headers=admin_h)
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        hist = order["status_history"]

        # Expect 4 entries: pending + paid + shipped + delivered
        assert len(hist) == 4, f"expected 4 entries, got {len(hist)}: {hist}"

        statuses = [h["status"] for h in hist]
        assert statuses == ["pending", "paid", "shipped", "delivered"], statuses

        # pending entry — no 'by'
        assert hist[0].get("note") == "Order placed"

        # admin-added entries carry 'by' = admin email + proper notes
        note_map = {"paid": "Payment confirmed", "shipped": "Order shipped", "delivered": "Order delivered"}
        for h in hist[1:]:
            assert h.get("by") == "TEST_admin@example.com", h
            assert h.get("note") == note_map[h["status"]], h
            assert _is_iso_string(h.get("at")), h

        # Chronological non-decreasing
        times = [datetime.fromisoformat(h["at"].replace("Z", "+00:00")) for h in hist]
        assert times == sorted(times), f"status_history not chronological: {times}"

        # Order top-level status reflects last transition
        assert order["status"] == "delivered"

    def test_admin_get_order_requires_admin(self, api, seeded_user, seeded_admin):
        d = _create_order(api, seeded_user["token"], method="upi")
        oid = d["order_id"]
        # Regular user forbidden
        r = api.get(f"{BASE_URL}/api/admin/orders/{oid}", headers=_h(seeded_user["token"]))
        assert r.status_code == 403, r.text
        # No auth 401
        r = api.get(f"{BASE_URL}/api/admin/orders/{oid}")
        assert r.status_code == 401
        # Admin OK
        r = api.get(f"{BASE_URL}/api/admin/orders/{oid}", headers=_h(seeded_admin["token"]))
        assert r.status_code == 200

    def test_admin_get_order_404(self, api, seeded_admin):
        r = api.get(f"{BASE_URL}/api/admin/orders/ord_does_not_exist",
                    headers=_h(seeded_admin["token"]))
        assert r.status_code == 404


# ---------- mock-pay appends paid event ----------
class TestMockPayHistory:
    def test_mock_pay_appends_paid_event(self, api, seeded_user):
        d = _create_order(api, seeded_user["token"], product_id="p_tulsi_tea", method="upi")
        oid = d["order_id"]
        h = _h(seeded_user["token"])

        r = api.post(f"{BASE_URL}/api/orders/{oid}/mock-pay", headers=h)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "paid"

        r = api.get(f"{BASE_URL}/api/orders/{oid}", headers=h)
        order = r.json()["order"]
        assert order["status"] == "paid"
        hist = order["status_history"]
        statuses = [e["status"] for e in hist]
        assert statuses == ["pending", "paid"], statuses
        paid_entry = hist[-1]
        assert paid_entry["note"] == "Payment received", paid_entry
        assert _is_iso_string(paid_entry["at"])


# ---------- Backfill at startup ----------
class TestBackfill:
    def test_legacy_order_backfilled(self, mongo, seeded_user, api):
        """Insert a legacy order (no status_history), then re-trigger the backfill
        via the same update_many used at startup, and verify."""
        legacy_oid = f"ord_LEGACY_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc)
        mongo.orders.insert_one({
            "id": legacy_oid,
            "user_id": seeded_user["user_id"],
            "user_email": "TEST_user@example.com",
            "user_name": "TEST User",
            "items": [{"product_id": "p_ashwagandha", "name": "A",
                       "image": "", "price": 1.0, "quantity": 1}],
            "address": {"full_name": "T", "phone": "9", "line1": "1",
                        "city": "C", "state": "T", "pincode": "600001"},
            "subtotal": 1.0, "shipping": 49.0, "total": 50.0,
            "payment_method": "upi", "razorpay_order_id": None,
            "upi_link": None, "merchant_vpa": None,
            "status": "pending",
            "created_at": now,
            # intentionally NO status_history
        })
        try:
            # Simulate the backfill aggregation pipeline (same shape as server.py startup)
            mongo.orders.update_many(
                {"status_history": {"$exists": False}},
                [{"$set": {"status_history": [{
                    "status": "$status",
                    "at": "$created_at",
                    "note": "Order placed",
                }]}}],
            )

            # Fetch via API — status_history should now be populated and serialized
            r = api.get(f"{BASE_URL}/api/orders/{legacy_oid}",
                        headers=_h(seeded_user["token"]))
            assert r.status_code == 200, r.text
            order = r.json()["order"]
            hist = order.get("status_history")
            assert isinstance(hist, list) and len(hist) == 1, hist
            assert hist[0]["status"] == "pending"
            assert hist[0]["note"] == "Order placed"
            assert _is_iso_string(hist[0]["at"])
        finally:
            mongo.orders.delete_one({"id": legacy_oid})

    def test_no_orders_missing_status_history_in_db(self, mongo):
        """After startup backfill, no orders in the DB should be missing status_history."""
        count = mongo.orders.count_documents({"status_history": {"$exists": False}})
        assert count == 0, f"{count} orders still missing status_history after startup backfill"


# ---------- Smoke tests for previously-passing surface area ----------
class TestRegressionSmoke:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json()["message"] == "Herbal Bloom API"

    def test_products_list(self, api):
        r = api.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        assert isinstance(r.json()["products"], list)
        assert len(r.json()["products"]) >= 1

    def test_categories(self, api):
        r = api.get(f"{BASE_URL}/api/products/categories")
        assert r.status_code == 200
        cats = r.json()["categories"]
        assert "All" in cats

    def test_product_detail(self, api):
        r = api.get(f"{BASE_URL}/api/products/p_ashwagandha")
        assert r.status_code == 200
        assert r.json()["product"]["id"] == "p_ashwagandha"

    def test_support_info(self, api):
        r = api.get(f"{BASE_URL}/api/support/info")
        assert r.status_code == 200
        for k in ("email", "whatsapp", "whatsapp_link", "merchant_vpa", "merchant_name"):
            assert k in r.json()

    def test_auth_me_requires_token(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_cart_round_trip(self, api, seeded_user):
        h = _h(seeded_user["token"])
        api.post(f"{BASE_URL}/api/cart/clear", headers=h)
        r = api.post(f"{BASE_URL}/api/cart/add",
                     json={"product_id": "p_neem_caps", "quantity": 2}, headers=h)
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/api/cart", headers=h)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(i["product_id"] == "p_neem_caps" and i["quantity"] == 2 for i in items)

    def test_admin_callmebot_requires_admin(self, api, seeded_user):
        r = api.get(f"{BASE_URL}/api/admin/callmebot", headers=_h(seeded_user["token"]))
        assert r.status_code == 403
