"""Iteration 2: new-feature backend tests for AVR Organics.

Covers:
- GET /api/orders/me response shape (id, items[], total, status, created_at) — needed by
  Profile tab 'Order Summary' section
- GET /api/support/info returns merchant_vpa and merchant_name
- PUT /api/admin/merchant updates VPA/name (admin gating enforced)
- POST /api/orders/create with payment_method=upi returns a valid upi:// link
- GET /api/admin/orders returns all orders + stats {pending, paid, revenue, count}
- PUT /api/admin/orders/{id}/status changes status (and paid_at when moving to paid)
- PUT /api/admin/products/{id}/stock toggles in_stock
"""
import os
import uuid
import urllib.parse as up
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _seed_cart_and_create_order(api, token, product_id="p_ashwagandha", method="upi"):
    h = _h(token)
    api.post(f"{BASE_URL}/api/cart/clear", headers=h)
    api.post(f"{BASE_URL}/api/cart/add",
             json={"product_id": product_id, "quantity": 1}, headers=h)
    addr = {
        "full_name": "TEST User", "phone": "9999999999",
        "line1": "1 Test St", "city": "Chennai",
        "state": "TN", "pincode": "600001",
    }
    r = api.post(f"{BASE_URL}/api/orders/create",
                 json={"address": addr, "payment_method": method}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Merchant / Support Info ----------
class TestMerchantSettings:
    def test_admin_update_merchant_and_reflect_in_support_info(self, api, seeded_admin):
        new_vpa = f"test-merchant-{uuid.uuid4().hex[:6]}@upi"
        new_name = "TEST AVR Organics"
        r = api.put(f"{BASE_URL}/api/admin/merchant",
                    json={"vpa": new_vpa, "name": new_name},
                    headers=_h(seeded_admin["token"]))
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify reflected via /api/support/info (public endpoint)
        r = api.get(f"{BASE_URL}/api/support/info")
        assert r.status_code == 200
        d = r.json()
        assert d.get("merchant_vpa") == new_vpa, d
        assert d.get("merchant_name") == new_name, d

    def test_merchant_update_forbidden_for_regular_user(self, api, seeded_user):
        r = api.put(f"{BASE_URL}/api/admin/merchant",
                    json={"vpa": "foo@upi", "name": "hack"},
                    headers=_h(seeded_user["token"]))
        assert r.status_code == 403

    def test_merchant_update_requires_auth(self, api):
        r = api.put(f"{BASE_URL}/api/admin/merchant",
                    json={"vpa": "foo@upi", "name": "n"})
        assert r.status_code == 401

    def test_merchant_name_defaults_when_blank(self, api, seeded_admin):
        # Trimming and empty-name -> defaults to 'AVR Organics'
        r = api.put(f"{BASE_URL}/api/admin/merchant",
                    json={"vpa": "  clean@upi  ", "name": "   "},
                    headers=_h(seeded_admin["token"]))
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/api/support/info")
        d = r.json()
        assert d["merchant_vpa"] == "clean@upi"
        assert d["merchant_name"] == "AVR Organics"


# ---------- UPI Order flow ----------
class TestUpiOrder:
    def test_create_order_upi_returns_upi_link(self, api, seeded_admin, seeded_user):
        # ensure merchant is configured
        vpa = "avrorganics@upi"
        api.put(f"{BASE_URL}/api/admin/merchant",
                json={"vpa": vpa, "name": "AVR Organics"},
                headers=_h(seeded_admin["token"]))

        d = _seed_cart_and_create_order(api, seeded_user["token"], method="upi")
        assert d["payment_method"] == "upi"
        assert d["merchant_vpa"] == vpa
        assert d["merchant_name"] == "AVR Organics"
        assert d["upi_link"], "upi_link should be present"
        assert d["upi_link"].startswith("upi://pay?")
        # Parse the query and validate params
        q = up.parse_qs(d["upi_link"].split("?", 1)[1])
        assert q["pa"][0] == vpa
        assert q["pn"][0] == "AVR Organics"
        assert q["cu"][0] == "INR"
        # amount matches total
        assert float(q["am"][0]) == float(d["total"])

    def test_create_order_upi_no_link_when_merchant_blank(self, api, seeded_admin, seeded_user):
        # Reset merchant vpa to blank
        api.put(f"{BASE_URL}/api/admin/merchant",
                json={"vpa": "", "name": "AVR Organics"},
                headers=_h(seeded_admin["token"]))
        d = _seed_cart_and_create_order(api, seeded_user["token"], method="upi")
        assert d["payment_method"] == "upi"
        assert d["upi_link"] is None
        assert d["merchant_vpa"] in (None, "")


# ---------- Profile 'Order Summary' backing endpoint ----------
class TestOrdersMeShape:
    def test_orders_me_shape_for_profile_order_summary(self, api, seeded_user):
        # create 2 orders
        d1 = _seed_cart_and_create_order(api, seeded_user["token"],
                                         product_id="p_ashwagandha", method="upi")
        d2 = _seed_cart_and_create_order(api, seeded_user["token"],
                                         product_id="p_tulsi_tea", method="upi")

        r = api.get(f"{BASE_URL}/api/orders/me", headers=_h(seeded_user["token"]))
        assert r.status_code == 200
        orders = r.json()["orders"]
        assert len(orders) >= 2
        ids = [o["id"] for o in orders]
        assert d1["order_id"] in ids and d2["order_id"] in ids

        # Newest first (sorted by created_at desc)
        assert orders[0]["id"] == d2["order_id"], \
            f"expected newest={d2['order_id']} first, got {orders[0]['id']}"

        # Each order must carry the fields Profile tab renders
        o0 = orders[0]
        for k in ("id", "items", "total", "status", "created_at"):
            assert k in o0, f"missing '{k}' in orders/me response"
        assert isinstance(o0["items"], list) and len(o0["items"]) >= 1
        first_item = o0["items"][0]
        for k in ("product_id", "name", "price", "quantity"):
            assert k in first_item, f"missing '{k}' in order item"
        # created_at must be ISO string (JSON serializable, not raw datetime)
        assert isinstance(o0["created_at"], str)
        assert o0["status"] in {"pending", "paid", "shipped", "delivered", "cancelled"}


# ---------- Admin Orders ----------
class TestAdminOrders:
    def test_admin_orders_list_with_stats(self, api, seeded_admin, seeded_user):
        # create fresh order as user
        d = _seed_cart_and_create_order(api, seeded_user["token"],
                                        product_id="p_ashwagandha", method="upi")
        r = api.get(f"{BASE_URL}/api/admin/orders",
                    headers=_h(seeded_admin["token"]))
        assert r.status_code == 200
        body = r.json()
        assert "orders" in body and "stats" in body
        stats = body["stats"]
        for k in ("pending", "paid", "revenue", "count"):
            assert k in stats
        assert any(o["id"] == d["order_id"] for o in body["orders"])

    def test_admin_orders_forbidden_for_user(self, api, seeded_user):
        r = api.get(f"{BASE_URL}/api/admin/orders",
                    headers=_h(seeded_user["token"]))
        assert r.status_code == 403

    def test_admin_update_order_status_flow(self, api, seeded_admin, seeded_user):
        d = _seed_cart_and_create_order(api, seeded_user["token"],
                                        product_id="p_tulsi_tea", method="upi")
        oid = d["order_id"]
        for status in ("paid", "shipped", "delivered"):
            r = api.put(f"{BASE_URL}/api/admin/orders/{oid}/status",
                        json={"status": status},
                        headers=_h(seeded_admin["token"]))
            assert r.status_code == 200, r.text
            # verify via user's /orders/me
            r = api.get(f"{BASE_URL}/api/orders/me",
                        headers=_h(seeded_user["token"]))
            match = [o for o in r.json()["orders"] if o["id"] == oid]
            assert match and match[0]["status"] == status
            if status == "paid":
                # paid_at should be set (ISO string)
                assert match[0].get("paid_at"), "paid_at should be set when moving to paid"

    def test_admin_update_order_status_invalid_400(self, api, seeded_admin, seeded_user):
        d = _seed_cart_and_create_order(api, seeded_user["token"], method="upi")
        r = api.put(f"{BASE_URL}/api/admin/orders/{d['order_id']}/status",
                    json={"status": "banana"},
                    headers=_h(seeded_admin["token"]))
        assert r.status_code == 400

    def test_admin_update_order_status_404(self, api, seeded_admin):
        r = api.put(f"{BASE_URL}/api/admin/orders/ord_does_not_exist/status",
                    json={"status": "paid"},
                    headers=_h(seeded_admin["token"]))
        assert r.status_code == 404


# ---------- Admin Product Stock Toggle ----------
class TestAdminStockToggle:
    def test_stock_toggle_flow(self, api, seeded_admin):
        h = _h(seeded_admin["token"])
        pid = "p_giloy"
        # Set false
        r = api.put(f"{BASE_URL}/api/admin/products/{pid}/stock",
                    json={"in_stock": False}, headers=h)
        assert r.status_code == 200
        assert r.json()["in_stock"] is False
        # Verify via public GET
        r = api.get(f"{BASE_URL}/api/products/{pid}")
        assert r.status_code == 200
        assert r.json()["product"]["in_stock"] is False
        # Set back true
        r = api.put(f"{BASE_URL}/api/admin/products/{pid}/stock",
                    json={"in_stock": True}, headers=h)
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/api/products/{pid}")
        assert r.json()["product"]["in_stock"] is True

    def test_stock_toggle_404(self, api, seeded_admin):
        r = api.put(f"{BASE_URL}/api/admin/products/does_not_exist/stock",
                    json={"in_stock": True}, headers=_h(seeded_admin["token"]))
        assert r.status_code == 404

    def test_stock_toggle_forbidden_for_user(self, api, seeded_user):
        r = api.put(f"{BASE_URL}/api/admin/products/p_giloy/stock",
                    json={"in_stock": False}, headers=_h(seeded_user["token"]))
        assert r.status_code == 403
