"""Backend end-to-end tests for AVR Organics / Herbal Bloom API."""
import os
import uuid
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Products & Categories ----------
class TestProducts:
    def test_list_products_returns_seeded_8(self, api):
        r = api.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        data = r.json()
        assert "products" in data
        assert len(data["products"]) >= 8
        p0 = data["products"][0]
        for k in ("id", "name", "price", "category", "avg_rating", "rating_count"):
            assert k in p0, f"missing {k}"

    def test_categories(self, api):
        r = api.get(f"{BASE_URL}/api/products/categories")
        assert r.status_code == 200
        cats = r.json()["categories"]
        assert cats[0] == "All"
        # multiple categories exist (admin may have renamed seed defaults)
        assert len(cats) >= 3

    def test_get_single_product(self, api):
        r = api.get(f"{BASE_URL}/api/products/p_ashwagandha")
        assert r.status_code == 200
        prod = r.json()["product"]
        assert prod["id"] == "p_ashwagandha"
        assert "avg_rating" in prod
        assert "rating_count" in prod

    def test_get_product_404(self, api):
        r = api.get(f"{BASE_URL}/api/products/does_not_exist")
        assert r.status_code == 404


# ---------- Support ----------
class TestSupport:
    def test_support_info(self, api):
        r = api.get(f"{BASE_URL}/api/support/info")
        assert r.status_code == 200
        d = r.json()
        assert "email" in d and "whatsapp" in d and "whatsapp_link" in d
        assert d["whatsapp_link"].startswith("https://wa.me/")


# ---------- Auth ----------
class TestAuth:
    def test_session_invalid_id_401(self, api):
        r = api.post(f"{BASE_URL}/api/auth/session", json={"session_id": "invalid_xyz_123"})
        assert r.status_code == 401

    def test_me_with_arbitrary_token_401(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me",
                    headers=auth_headers("totally_fake_token_xyz"))
        assert r.status_code == 401

    def test_me_no_token_401(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_with_seeded_token(self, api, seeded_user):
        r = api.get(f"{BASE_URL}/api/auth/me",
                    headers=auth_headers(seeded_user["token"]))
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["user_id"] == seeded_user["user_id"]
        assert u["email"] == "TEST_user@example.com"


# ---------- Cart ----------
class TestCart:
    def test_cart_flow(self, api, seeded_user, mongo):
        h = auth_headers(seeded_user["token"])
        # clear first
        api.post(f"{BASE_URL}/api/cart/clear", headers=h)

        # add 2 of ashwagandha
        r = api.post(f"{BASE_URL}/api/cart/add",
                     json={"product_id": "p_ashwagandha", "quantity": 2}, headers=h)
        assert r.status_code == 200
        # add 1 tulsi
        r = api.post(f"{BASE_URL}/api/cart/add",
                     json={"product_id": "p_tulsi_tea", "quantity": 1}, headers=h)
        assert r.status_code == 200

        # GET cart
        r = api.get(f"{BASE_URL}/api/cart", headers=h)
        assert r.status_code == 200
        d = r.json()
        assert len(d["items"]) == 2
        # subtotal should be 499*2 + 249 = 1247
        assert d["subtotal"] == 1247.0
        for it in d["items"]:
            assert "product" in it and it["product"]["id"] == it["product_id"]

        # update tulsi qty to 3
        r = api.post(f"{BASE_URL}/api/cart/update",
                     json={"product_id": "p_tulsi_tea", "quantity": 3}, headers=h)
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/api/cart", headers=h)
        items = {it["product_id"]: it["quantity"] for it in r.json()["items"]}
        assert items["p_tulsi_tea"] == 3
        assert items["p_ashwagandha"] == 2

        # clear
        r = api.post(f"{BASE_URL}/api/cart/clear", headers=h)
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/api/cart", headers=h)
        assert r.json()["items"] == []
        assert r.json()["subtotal"] == 0

    def test_cart_unauth(self, api):
        r = api.get(f"{BASE_URL}/api/cart")
        assert r.status_code == 401


# ---------- Orders, Mock Pay & Reviews ----------
class TestOrdersAndReviews:
    def _make_order(self, api, token, product_id="p_ashwagandha"):
        h = auth_headers(token)
        api.post(f"{BASE_URL}/api/cart/clear", headers=h)
        api.post(f"{BASE_URL}/api/cart/add",
                 json={"product_id": product_id, "quantity": 1}, headers=h)
        addr = {
            "full_name": "TEST User", "phone": "9999999999",
            "line1": "1 Test St", "city": "Chennai",
            "state": "TN", "pincode": "600001",
        }
        r = api.post(f"{BASE_URL}/api/orders/create",
                     json={"address": addr, "payment_method": "razorpay"}, headers=h)
        assert r.status_code == 200, r.text
        return r.json()

    def test_order_create_returns_mock_rzp_id(self, api, seeded_user):
        d = self._make_order(api, seeded_user["token"])
        assert d["razorpay_order_id"], "should have rzp order id"
        # keys are blank so should be mock_
        assert d["razorpay_order_id"].startswith("mock_"), d["razorpay_order_id"]
        assert d["order_id"].startswith("ord_")
        assert d["currency"] == "INR"

    def test_orders_me_lists_orders(self, api, seeded_user):
        h = auth_headers(seeded_user["token"])
        d = self._make_order(api, seeded_user["token"])
        r = api.get(f"{BASE_URL}/api/orders/me", headers=h)
        assert r.status_code == 200
        ids = [o["id"] for o in r.json()["orders"]]
        assert d["order_id"] in ids

    def test_review_before_purchase_403(self, api, seeded_user, mongo):
        # ensure user has no paid order for p_neem_caps
        mongo.orders.delete_many({"user_id": seeded_user["user_id"]})
        mongo.reviews.delete_many({"user_id": seeded_user["user_id"],
                                    "product_id": "p_neem_caps"})
        h = auth_headers(seeded_user["token"])
        r = api.post(f"{BASE_URL}/api/reviews",
                     json={"product_id": "p_neem_caps", "rating": 5, "comment": "x"},
                     headers=h)
        assert r.status_code == 403

    def test_mock_pay_then_review_then_upsert(self, api, seeded_user, mongo):
        product_id = "p_neem_caps"
        mongo.reviews.delete_many({"user_id": seeded_user["user_id"],
                                    "product_id": product_id})
        h = auth_headers(seeded_user["token"])
        d = self._make_order(api, seeded_user["token"], product_id=product_id)
        order_id = d["order_id"]

        # Mock pay
        r = api.post(f"{BASE_URL}/api/orders/{order_id}/mock-pay", headers=h)
        assert r.status_code == 200
        assert r.json()["status"] == "paid"

        # Cart should be cleared
        r = api.get(f"{BASE_URL}/api/cart", headers=h)
        assert r.json()["items"] == []

        # GET order shows paid
        r = api.get(f"{BASE_URL}/api/orders/{order_id}", headers=h)
        assert r.status_code == 200
        assert r.json()["order"]["status"] == "paid"

        # Now review should succeed
        r = api.post(f"{BASE_URL}/api/reviews",
                     json={"product_id": product_id, "rating": 4, "comment": "good"},
                     headers=h)
        assert r.status_code == 200, r.text

        # Verify review persisted via GET reviews endpoint
        r = api.get(f"{BASE_URL}/api/products/{product_id}/reviews")
        revs = r.json()["reviews"]
        my = [x for x in revs if x["user_id"] == seeded_user["user_id"]]
        assert len(my) == 1
        assert my[0]["rating"] == 4

        # Upsert: submitting again must NOT duplicate
        r = api.post(f"{BASE_URL}/api/reviews",
                     json={"product_id": product_id, "rating": 5, "comment": "great"},
                     headers=h)
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/api/products/{product_id}/reviews")
        my = [x for x in r.json()["reviews"] if x["user_id"] == seeded_user["user_id"]]
        assert len(my) == 1
        assert my[0]["rating"] == 5  # updated

        # avg_rating should reflect in product detail
        r = api.get(f"{BASE_URL}/api/products/{product_id}")
        prod = r.json()["product"]
        assert prod["rating_count"] >= 1
        assert prod["avg_rating"] >= 1


# ---------- Admin ----------
class TestAdmin:
    def test_admin_support_forbidden_for_user(self, api, seeded_user):
        r = api.put(f"{BASE_URL}/api/admin/support",
                    json={"email": "x@y.com", "whatsapp": "+910000000000"},
                    headers=auth_headers(seeded_user["token"]))
        assert r.status_code == 403

    def test_admin_products_forbidden_for_user(self, api, seeded_user):
        r = api.post(f"{BASE_URL}/api/admin/products",
                     json={"name": "x", "price": 1.0, "image": "", "category": "T"},
                     headers=auth_headers(seeded_user["token"]))
        assert r.status_code == 403

    def test_admin_support_update_and_reflect(self, api, seeded_admin):
        new_email = f"TEST_support_{uuid.uuid4().hex[:6]}@example.com"
        new_wp = "+919000000001"
        r = api.put(f"{BASE_URL}/api/admin/support",
                    json={"email": new_email, "whatsapp": new_wp},
                    headers=auth_headers(seeded_admin["token"]))
        assert r.status_code == 200
        # Reflected
        r = api.get(f"{BASE_URL}/api/support/info")
        d = r.json()
        assert d["email"] == new_email
        assert d["whatsapp"] == new_wp
        assert d["whatsapp_link"] == "https://wa.me/919000000001"

    def test_admin_product_crud(self, api, seeded_admin, mongo):
        h = auth_headers(seeded_admin["token"])
        payload = {
            "name": "TEST_Herbal_X", "tagline": "test", "description": "test prod",
            "price": 199.0, "image": "https://example.com/x.jpg",
            "category": "Capsules", "benefits": ["a"], "ingredients": ["b"],
            "in_stock": True,
        }
        # CREATE
        r = api.post(f"{BASE_URL}/api/admin/products", json=payload, headers=h)
        assert r.status_code == 200
        pid = r.json()["product"]["id"]
        assert pid.startswith("p_")

        # GET to verify persisted
        r = api.get(f"{BASE_URL}/api/products/{pid}")
        assert r.status_code == 200
        assert r.json()["product"]["name"] == "TEST_Herbal_X"

        # UPDATE
        payload["name"] = "TEST_Herbal_X2"
        payload["price"] = 249.0
        r = api.put(f"{BASE_URL}/api/admin/products/{pid}", json=payload, headers=h)
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/api/products/{pid}")
        assert r.json()["product"]["name"] == "TEST_Herbal_X2"
        assert r.json()["product"]["price"] == 249.0

        # DELETE
        r = api.delete(f"{BASE_URL}/api/admin/products/{pid}", headers=h)
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/api/products/{pid}")
        assert r.status_code == 404
