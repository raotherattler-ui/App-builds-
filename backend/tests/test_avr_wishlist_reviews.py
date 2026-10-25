# Wishlist hearts, back-in-stock alerts, photo reviews (verified buyers only) — AVR Organics
import io
import uuid
import time
import pytest
import requests
from datetime import datetime, timezone, timedelta

from conftest import BASE_URL, auth_headers

API = f"{BASE_URL}/api"
PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")


def _mk_user(mongo, name, is_admin=False, email=None):
    uid = f"user_TEST_{uuid.uuid4().hex[:8]}"
    email = email or f"delivered+{uid.lower()}@resend.dev"
    tok = f"sess_TEST_{uuid.uuid4().hex[:16]}"
    mongo.users.insert_one({"user_id": uid, "email": email, "name": name, "picture": "",
                            "is_admin": is_admin, "created_at": datetime.now(timezone.utc)})
    mongo.user_sessions.insert_one({"session_token": tok, "user_id": uid,
                                    "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                                    "created_at": datetime.now(timezone.utc)})
    return {"user_id": uid, "token": tok}


def _mk_order(mongo, user_id, product_id, status):
    oid = f"ord_TEST_{uuid.uuid4().hex[:10]}"
    mongo.orders.insert_one({"id": oid, "user_id": user_id, "status": status, "total": 100,
                             "items": [{"product_id": product_id, "name": "x", "price": 100, "quantity": 1}],
                             "created_at": datetime.now(timezone.utc)})
    return oid


@pytest.fixture(scope="module")
def ctx(mongo):
    stale = [u["user_id"] for u in mongo.users.find({"email": {"$regex": "_wr@avr\\.local$"}})]
    mongo.users.delete_many({"user_id": {"$in": stale}})
    mongo.user_sessions.delete_many({"user_id": {"$in": stale}})
    admin = _mk_user(mongo, "TEST Admin WR", is_admin=True, email="TEST_admin_wr@avr.local")
    u1 = _mk_user(mongo, "TEST Shopper One")
    u2 = _mk_user(mongo, "TEST Shopper Two")
    buyer = _mk_user(mongo, "TEST Buyer", email="TEST_buyer_wr@avr.local")
    pending = _mk_user(mongo, "TEST Pending", email="TEST_pending_wr@avr.local")
    nobuy = _mk_user(mongo, "TEST NoBuy", email="TEST_nobuy_wr@avr.local")
    pid = f"p_TEST_{uuid.uuid4().hex[:8]}"
    r = requests.put(f"{API}/admin/products/{pid}", headers=auth_headers(admin["token"]),
                     json={"name": "TEST Wishlist Herb", "price": 199, "category": "Powders", "in_stock": True})
    assert r.status_code == 200, r.text
    _mk_order(mongo, buyer["user_id"], pid, "delivered")
    _mk_order(mongo, pending["user_id"], pid, "pending")
    users = [admin, u1, u2, buyer, pending, nobuy]
    yield {"admin": admin, "u1": u1, "u2": u2, "buyer": buyer, "pending": pending, "nobuy": nobuy, "pid": pid}
    ids = [u["user_id"] for u in users]
    for coll in ("users", "user_sessions", "orders", "reviews", "wishlist", "stock_alerts", "uploads", "carts"):
        mongo[coll].delete_many({"user_id": {"$in": ids}})
    mongo.uploads.delete_many({"owner_id": {"$in": ids}})
    mongo.products.delete_many({"id": pid})


# ---- Wishlist ----
class TestWishlist:
    def test_requires_auth(self):
        assert requests.get(f"{API}/wishlist").status_code == 401
        assert requests.post(f"{API}/wishlist/p_x").status_code == 401
        assert requests.delete(f"{API}/wishlist/p_x").status_code == 401

    def test_unknown_product_404(self, ctx):
        r = requests.post(f"{API}/wishlist/p_does_not_exist_xyz", headers=auth_headers(ctx["u1"]["token"]))
        assert r.status_code == 404

    def test_add_idempotent_get_remove(self, ctx, mongo):
        h = auth_headers(ctx["u1"]["token"])
        for _ in range(2):
            r = requests.post(f"{API}/wishlist/{ctx['pid']}", headers=h)
            assert r.status_code == 200 and r.json()["saved"] is True
        assert mongo.wishlist.count_documents({"user_id": ctx["u1"]["user_id"], "product_id": ctx["pid"]}) == 1
        d = requests.get(f"{API}/wishlist", headers=h).json()
        assert ctx["pid"] in d["product_ids"]
        item = [i for i in d["items"] if i["product"]["id"] == ctx["pid"]][0]
        assert item["back_in_stock"] is False and item["product"]["name"] == "TEST Wishlist Herb"
        assert "_id" not in item["product"]
        r = requests.delete(f"{API}/wishlist/{ctx['pid']}", headers=h)
        assert r.status_code == 200 and r.json()["saved"] is False
        assert ctx["pid"] not in requests.get(f"{API}/wishlist", headers=h).json()["product_ids"]


# ---- Back in stock ----
class TestBackInStock:
    def test_stock_toggle_notifies_wishlisters(self, ctx, mongo):
        for u in ("u1", "u2"):
            assert requests.post(f"{API}/wishlist/{ctx['pid']}", headers=auth_headers(ctx[u]["token"])).status_code == 200
        ah = auth_headers(ctx["admin"]["token"])
        r = requests.put(f"{API}/admin/products/{ctx['pid']}/stock", headers=ah, json={"in_stock": False})
        assert r.status_code == 200 and r.json()["notified"] == 0
        # out-of-stock -> no alert surfaced
        assert requests.get(f"{API}/stock-alerts", headers=auth_headers(ctx["u1"]["token"])).json()["alerts"] == []
        r = requests.put(f"{API}/admin/products/{ctx['pid']}/stock", headers=ah, json={"in_stock": True})
        assert r.status_code == 200 and r.json()["notified"] == 2
        for u in ("u1", "u2"):
            assert mongo.stock_alerts.count_documents({"user_id": ctx[u]["user_id"], "product_id": ctx["pid"], "seen": False}) == 1
        # true -> true should not re-notify
        r = requests.put(f"{API}/admin/products/{ctx['pid']}/stock", headers=ah, json={"in_stock": True})
        assert r.json()["notified"] == 0

    def test_stock_alerts_get_and_seen(self, ctx):
        h = auth_headers(ctx["u1"]["token"])
        alerts = requests.get(f"{API}/stock-alerts", headers=h).json()["alerts"]
        assert len(alerts) == 1 and alerts[0]["product"]["id"] == ctx["pid"]
        wl = requests.get(f"{API}/wishlist", headers=h).json()
        assert [i for i in wl["items"] if i["product"]["id"] == ctx["pid"]][0]["back_in_stock"] is True
        assert requests.post(f"{API}/stock-alerts/seen", headers=h).status_code == 200
        assert requests.get(f"{API}/stock-alerts", headers=h).json()["alerts"] == []
        # u2 still has alert
        assert len(requests.get(f"{API}/stock-alerts", headers=auth_headers(ctx["u2"]["token"])).json()["alerts"]) == 1

    def test_stock_toggle_non_admin_403(self, ctx):
        r = requests.put(f"{API}/admin/products/{ctx['pid']}/stock", headers=auth_headers(ctx["u1"]["token"]), json={"in_stock": False})
        assert r.status_code == 403

    def test_full_product_update_triggers_alert(self, ctx, mongo):
        ah = auth_headers(ctx["admin"]["token"])
        base = {"name": "TEST Wishlist Herb", "price": 199, "category": "Powders"}
        requests.post(f"{API}/stock-alerts/seen", headers=auth_headers(ctx["u2"]["token"]))
        assert requests.put(f"{API}/admin/products/{ctx['pid']}", headers=ah, json={**base, "in_stock": False}).status_code == 200
        assert requests.put(f"{API}/admin/products/{ctx['pid']}", headers=ah, json={**base, "in_stock": True}).status_code == 200
        for u in ("u1", "u2"):
            assert mongo.stock_alerts.count_documents({"user_id": ctx[u]["user_id"], "product_id": ctx["pid"], "seen": False}) == 1
        assert mongo.products.find_one({"id": ctx["pid"]})["in_stock"] is True

    def test_remove_wishlist_clears_alert(self, ctx, mongo):
        h = auth_headers(ctx["u2"]["token"])
        requests.delete(f"{API}/wishlist/{ctx['pid']}", headers=h)
        assert requests.get(f"{API}/stock-alerts", headers=h).json()["alerts"] == []


# ---- Photo reviews ----
class TestReviews:
    def _upload(self, token):
        return requests.post(f"{API}/upload/review", headers={"Authorization": f"Bearer {token}"},
                             files={"file": ("r.png", io.BytesIO(PNG), "image/png")})

    def test_upload_review_permissions(self, ctx):
        assert self._upload(ctx["nobuy"]["token"]).status_code == 403
        assert self._upload(ctx["pending"]["token"]).status_code == 403
        r = self._upload(ctx["buyer"]["token"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["relative_url"].startswith("/api/files/") and "url" in d
        # admin-only upload still blocked for customers
        r2 = requests.post(f"{API}/upload", headers={"Authorization": f"Bearer {ctx['buyer']['token']}"},
                           files={"file": ("r.png", io.BytesIO(PNG), "image/png")})
        assert r2.status_code == 403

    def test_review_requires_purchase(self, ctx):
        body = {"product_id": ctx["pid"], "rating": 4, "comment": "TEST"}
        assert requests.post(f"{API}/reviews", headers=auth_headers(ctx["nobuy"]["token"]), json=body).status_code == 403
        assert requests.post(f"{API}/reviews", headers=auth_headers(ctx["pending"]["token"]), json=body).status_code == 403

    def test_review_photo_validation(self, ctx):
        h = auth_headers(ctx["buyer"]["token"])
        urls = [self._upload(ctx["buyer"]["token"]).json()["relative_url"] for _ in range(4)]
        r = requests.post(f"{API}/reviews", headers=h, json={"product_id": ctx["pid"], "rating": 5, "comment": "TEST", "photos": urls})
        assert r.status_code == 400
        r = requests.post(f"{API}/reviews", headers=h, json={"product_id": ctx["pid"], "rating": 5, "comment": "TEST",
                                                             "photos": ["https://evil.example.com/a.png"]})
        assert r.status_code == 400
        r = requests.post(f"{API}/reviews", headers=h, json={"product_id": ctx["pid"], "rating": 5, "comment": "TEST",
                                                             "photos": ["/api/files/avr/uploads/someone_else/x.png"]})
        assert r.status_code == 400
        r = requests.post(f"{API}/reviews", headers=h, json={"product_id": ctx["pid"], "rating": 5, "comment": "TEST great",
                                                             "photos": urls[:3]})
        assert r.status_code == 200, r.text
        # photo is served via public token
        assert requests.get(f"{BASE_URL}{urls[0]}").status_code == 200

    def test_review_photo_owned_by_other_user_rejected(self, ctx, mongo):
        other_url = self._upload(ctx["buyer"]["token"]).json()["relative_url"]
        # give u1 a purchase so they pass purchase check
        _mk_order(mongo, ctx["u1"]["user_id"], ctx["pid"], "paid")
        r = requests.post(f"{API}/reviews", headers=auth_headers(ctx["u1"]["token"]),
                          json={"product_id": ctx["pid"], "rating": 3, "comment": "TEST", "photos": [other_url]})
        assert r.status_code == 400
        r = requests.post(f"{API}/reviews", headers=auth_headers(ctx["u1"]["token"]),
                          json={"product_id": ctx["pid"], "rating": 3, "comment": "TEST no photos"})
        assert r.status_code == 200

    def test_get_reviews_counts_and_filter(self, ctx):
        d = requests.get(f"{API}/products/{ctx['pid']}/reviews").json()
        assert d["total"] == 2 and d["counts"] == {"1": 0, "2": 0, "3": 1, "4": 0, "5": 1}
        five = [r for r in d["reviews"] if r["rating"] == 5][0]
        assert len(five["photos"]) == 3 and five["verified"] is True and "user_id" not in five
        f = requests.get(f"{API}/products/{ctx['pid']}/reviews?rating=5").json()
        assert len(f["reviews"]) == 1 and f["reviews"][0]["rating"] == 5
        assert f["counts"]["3"] == 1  # counts unaffected by filter

    def test_eligibility(self, ctx):
        assert requests.get(f"{API}/reviews/eligibility/{ctx['pid']}", headers=auth_headers(ctx["buyer"]["token"])).json()["eligible"] is True
        assert requests.get(f"{API}/reviews/eligibility/{ctx['pid']}", headers=auth_headers(ctx["pending"]["token"])).json()["eligible"] is False
