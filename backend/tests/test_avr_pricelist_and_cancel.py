"""
Tests for Price List feature (public + admin) and customer order cancel.
Covers:
  - GET /api/pricelist (public, no auth)
  - GET /api/admin/pricelist (admin-only auth)
  - PUT /api/admin/pricelist/images (admin-only, de-dupe, cap 5, persistence)
  - POST /api/orders/{order_id}/cancel (customer-only, status gating)
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone

from conftest import auth_headers, _seed_user


# ---------- Price list: public ----------
class TestPricelistPublic:
    def test_public_pricelist_no_auth(self, api, base_url, mongo):
        """New simplified spec: /api/pricelist returns ONLY {images: [...]} —
        the earlier `categories`, `products`, `total_products` keys were REMOVED
        per user requirement ('without price option')."""
        r = requests.get(f"{base_url}/api/pricelist")
        assert r.status_code == 200, r.text
        body = r.json()
        # Shape: images only
        assert "images" in body
        assert isinstance(body["images"], list)
        # Regression: forbidden legacy keys must NOT be returned
        for forbidden in ("categories", "products", "total_products"):
            assert forbidden not in body, f"'{forbidden}' leaked back into GET /api/pricelist"
        # Each image is a string
        for u in body["images"]:
            assert isinstance(u, str) and u
        # Cap of 5 is enforced on read as well
        assert len(body["images"]) <= 5


# ---------- Price list: admin ----------
class TestPricelistAdmin:
    def test_admin_pricelist_requires_auth(self, base_url):
        r = requests.get(f"{base_url}/api/admin/pricelist")
        assert r.status_code == 401

    def test_admin_pricelist_rejects_non_admin(self, base_url, seeded_user):
        r = requests.get(f"{base_url}/api/admin/pricelist", headers=auth_headers(seeded_user["token"]))
        assert r.status_code in (401, 403)

    def test_admin_pricelist_get_with_admin(self, base_url, seeded_admin):
        r = requests.get(f"{base_url}/api/admin/pricelist", headers=auth_headers(seeded_admin["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "images" in body and isinstance(body["images"], list)

    def test_admin_put_images_requires_auth(self, base_url):
        r = requests.put(f"{base_url}/api/admin/pricelist/images", json={"images": ["https://x/a.png"]})
        assert r.status_code == 401

    def test_admin_put_images_non_admin(self, base_url, seeded_user):
        r = requests.put(
            f"{base_url}/api/admin/pricelist/images",
            json={"images": ["https://x/a.png"]},
            headers=auth_headers(seeded_user["token"]),
        )
        assert r.status_code in (401, 403)

    def test_admin_put_images_dedupe_cap_persist(self, base_url, seeded_admin, mongo):
        # Snapshot pre-existing value (if any) and restore at the end
        before = mongo.settings.find_one({"key": "pricelist"}, {"_id": 0})
        try:
            urls = [f"https://example.test/pl_{i}.png" for i in range(7)]
            # Introduce duplicates and blanks
            payload_imgs = urls[:3] + [""] + [urls[0]] + urls[3:]
            r = requests.put(
                f"{base_url}/api/admin/pricelist/images",
                json={"images": payload_imgs},
                headers=auth_headers(seeded_admin["token"]),
            )
            assert r.status_code == 200, r.text
            saved = r.json()["images"]
            # De-duped and capped at 5
            assert len(saved) == 5
            assert len(set(saved)) == 5
            # Order preserved from first occurrences — first 5 of urls
            assert saved == urls[:5]

            # Reflected via admin GET
            r2 = requests.get(f"{base_url}/api/admin/pricelist", headers=auth_headers(seeded_admin["token"]))
            assert r2.status_code == 200
            assert r2.json()["images"] == saved

            # And via public pricelist GET
            r3 = requests.get(f"{base_url}/api/pricelist")
            assert r3.status_code == 200
            assert r3.json()["images"] == saved
        finally:
            if before is None:
                mongo.settings.delete_one({"key": "pricelist"})
            else:
                mongo.settings.update_one(
                    {"key": "pricelist"},
                    {"$set": before},
                    upsert=True,
                )

    def test_admin_put_empty_clears(self, base_url, seeded_admin, mongo):
        before = mongo.settings.find_one({"key": "pricelist"}, {"_id": 0})
        try:
            r = requests.put(
                f"{base_url}/api/admin/pricelist/images",
                json={"images": []},
                headers=auth_headers(seeded_admin["token"]),
            )
            assert r.status_code == 200
            assert r.json()["images"] == []
            r2 = requests.get(f"{base_url}/api/pricelist")
            assert r2.json()["images"] == []
        finally:
            if before is None:
                mongo.settings.delete_one({"key": "pricelist"})
            else:
                mongo.settings.update_one({"key": "pricelist"}, {"$set": before}, upsert=True)

    def test_admin_put_preserves_order(self, base_url, seeded_admin, mongo):
        """PUT [a, b, c] → GET returns exactly [a, b, c] in the same order."""
        before = mongo.settings.find_one({"key": "pricelist"}, {"_id": 0})
        try:
            payload = [
                "https://example.test/orderA.jpg",
                "https://example.test/orderB.jpg",
                "https://example.test/orderC.jpg",
            ]
            r = requests.put(
                f"{base_url}/api/admin/pricelist/images",
                json={"images": payload},
                headers=auth_headers(seeded_admin["token"]),
            )
            assert r.status_code == 200
            assert r.json()["images"] == payload
            # Public endpoint preserves order too
            r2 = requests.get(f"{base_url}/api/pricelist")
            assert r2.status_code == 200
            assert r2.json()["images"] == payload
        finally:
            if before is None:
                mongo.settings.delete_one({"key": "pricelist"})
            else:
                mongo.settings.update_one({"key": "pricelist"}, {"$set": before}, upsert=True)

    def test_pricelist_persists_in_settings_collection(self, base_url, seeded_admin, mongo):
        """Images are stored in `settings` collection under key='pricelist' —
        this guarantees persistence across backend restarts."""
        before = mongo.settings.find_one({"key": "pricelist"}, {"_id": 0})
        try:
            urls = [
                "https://example.test/persist1.jpg",
                "https://example.test/persist2.jpg",
            ]
            r = requests.put(
                f"{base_url}/api/admin/pricelist/images",
                json={"images": urls},
                headers=auth_headers(seeded_admin["token"]),
            )
            assert r.status_code == 200
            # Verify directly in Mongo
            doc = mongo.settings.find_one({"key": "pricelist"}, {"_id": 0})
            assert doc is not None
            assert doc["key"] == "pricelist"
            assert doc["images"] == urls
            # A fresh public GET (simulates another process reading from DB)
            r2 = requests.get(f"{base_url}/api/pricelist")
            assert r2.json()["images"] == urls
        finally:
            if before is None:
                mongo.settings.delete_one({"key": "pricelist"})
            else:
                mongo.settings.update_one({"key": "pricelist"}, {"$set": before}, upsert=True)


# ---------- Regression: existing endpoints unaffected ----------
class TestRegressionNoImpact:
    def test_products_endpoint_still_works(self, base_url):
        r = requests.get(f"{base_url}/api/products")
        assert r.status_code == 200
        body = r.json()
        assert "products" in body and isinstance(body["products"], list)
        assert len(body["products"]) > 0

    def test_products_categories_still_works(self, base_url):
        r = requests.get(f"{base_url}/api/products/categories")
        assert r.status_code == 200
        body = r.json()
        assert "categories" in body and isinstance(body["categories"], list)
        assert body["categories"][0] == "All"

    def test_privacy_json_still_works(self, base_url):
        r = requests.get(f"{base_url}/api/privacy")
        assert r.status_code == 200
        body = r.json()
        assert "text" in body and "last_updated" in body

    def test_admin_products_requires_auth(self, base_url):
        r = requests.post(f"{base_url}/api/admin/products", json={"name": "x", "price": 1, "category": "x"})
        assert r.status_code == 401

    def test_orders_me_requires_auth(self, base_url):
        r = requests.get(f"{base_url}/api/orders/me")
        assert r.status_code == 401

    def test_health_still_200(self, base_url):
        r = requests.get(f"{base_url}/api/health")
        assert r.status_code == 200


# ---------- Order cancel ----------
def _seed_order(mongo, user_id, status="pending"):
    now = datetime.now(timezone.utc)
    oid = f"ord_TEST_{uuid.uuid4().hex[:10]}"
    doc = {
        "id": oid,
        "user_id": user_id,
        "user_email": "TEST_user@example.com",
        "user_name": "TEST User",
        "items": [{"product_id": "p_test", "name": "Test", "image": "", "price": 100.0, "quantity": 1}],
        "address": {"full_name": "T", "phone": "1", "line1": "x", "city": "c", "state": "s", "pincode": "000000"},
        "subtotal": 100.0, "shipping": 49.0, "total": 149.0,
        "payment_method": "upi",
        "status": status,
        "status_history": [{"status": "pending", "at": now, "note": "Order placed"}],
        "created_at": now,
    }
    mongo.orders.insert_one(doc)
    return oid


class TestOrderCancel:
    def test_cancel_requires_auth(self, base_url):
        r = requests.post(f"{base_url}/api/orders/does_not_matter/cancel")
        assert r.status_code == 401

    def test_cancel_404_when_not_owned(self, base_url, mongo, seeded_user):
        # Create order owned by somebody else
        other_uid, _ = _seed_user(mongo, "TEST_other@example.com", "Other", is_admin=False)
        oid = _seed_order(mongo, other_uid, status="pending")
        try:
            r = requests.post(
                f"{base_url}/api/orders/{oid}/cancel",
                headers=auth_headers(seeded_user["token"]),
            )
            assert r.status_code == 404
        finally:
            mongo.orders.delete_many({"id": oid})
            mongo.users.delete_many({"user_id": other_uid})
            mongo.user_sessions.delete_many({"user_id": other_uid})

    def test_cancel_404_when_missing(self, base_url, seeded_user):
        r = requests.post(
            f"{base_url}/api/orders/ord_nope_{uuid.uuid4().hex[:6]}/cancel",
            headers=auth_headers(seeded_user["token"]),
        )
        assert r.status_code == 404

    def test_cancel_pending_success(self, base_url, mongo, seeded_user):
        oid = _seed_order(mongo, seeded_user["user_id"], status="pending")
        try:
            r = requests.post(
                f"{base_url}/api/orders/{oid}/cancel",
                headers=auth_headers(seeded_user["token"]),
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] is True
            assert body["status"] == "cancelled"
            # Persistence
            doc = mongo.orders.find_one({"id": oid}, {"_id": 0})
            assert doc["status"] == "cancelled"
            assert "cancelled_at" in doc
            hist = doc.get("status_history") or []
            assert any(h["status"] == "cancelled" and h.get("note") == "Cancelled by customer" for h in hist)
        finally:
            mongo.orders.delete_many({"id": oid})

    @pytest.mark.parametrize("status", ["paid", "shipped", "delivered", "cancelled"])
    def test_cancel_blocked_for_non_pending(self, base_url, mongo, seeded_user, status):
        oid = _seed_order(mongo, seeded_user["user_id"], status=status)
        try:
            r = requests.post(
                f"{base_url}/api/orders/{oid}/cancel",
                headers=auth_headers(seeded_user["token"]),
            )
            assert r.status_code == 400, r.text
            # Status unchanged
            doc = mongo.orders.find_one({"id": oid}, {"_id": 0})
            assert doc["status"] == status
        finally:
            mongo.orders.delete_many({"id": oid})

    def test_cancel_idempotent_second_call_blocked(self, base_url, mongo, seeded_user):
        oid = _seed_order(mongo, seeded_user["user_id"], status="pending")
        try:
            r1 = requests.post(f"{base_url}/api/orders/{oid}/cancel", headers=auth_headers(seeded_user["token"]))
            assert r1.status_code == 200
            r2 = requests.post(f"{base_url}/api/orders/{oid}/cancel", headers=auth_headers(seeded_user["token"]))
            assert r2.status_code == 400
        finally:
            mongo.orders.delete_many({"id": oid})
