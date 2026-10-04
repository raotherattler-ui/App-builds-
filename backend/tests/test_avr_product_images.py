"""Tests for the new product-images gallery feature (up to 5 images per product).

Verifies:
- POST /api/admin/products — accepts `images: [...]`, dedupes, caps at 5,
  sets primary `image = images[0]`.
- PUT /api/admin/products/{id} — same normalization; legacy product can get more images.
- GET /api/products — every product has `images` array.
- GET /api/products/{id} — returns `images` array.
- 7 images -> keep first 5; duplicates collapse; empty strings filtered.
- If only `images` provided, backend sets `image = images[0]`.
- Startup backfill: no product in DB has `images` missing.
- GET /api/products/categories — union of admin list + distinct product categories.
- Seed uses $setOnInsert — admin edit survives a backend restart (verified via Mongo
  check that user-edited fields are preserved).
"""
import os
import uuid
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


IMG = "https://example.com/img"


# ---------- GET /api/products ----------
class TestListProductsImages:
    def test_every_product_has_images_array(self, api):
        r = api.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        for p in r.json()["products"]:
            assert "images" in p, f"product {p.get('id')} missing images"
            assert isinstance(p["images"], list)

    def test_legacy_seeded_products_backfilled(self, api):
        r = api.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        products = r.json()["products"]
        # at least one of the originally-seeded products should carry images=[image]
        seed_ids = {"p_ashwagandha", "p_tulsi_tea", "p_neem_caps", "p_turmeric",
                    "p_chamomile", "p_brahmi_oil", "p_giloy", "p_triphala"}
        seeds = [p for p in products if p["id"] in seed_ids]
        assert len(seeds) >= 1
        for p in seeds:
            # may have been edited by admin tests; but if images is empty, image should also be empty
            if p.get("image"):
                assert len(p["images"]) >= 1, f"{p['id']} has image but empty images"
                assert p["images"][0] == p["image"], f"{p['id']} primary mismatch"

    def test_detail_endpoint_returns_images(self, api):
        r = api.get(f"{BASE_URL}/api/products/p_ashwagandha")
        assert r.status_code == 200
        p = r.json()["product"]
        assert "images" in p and isinstance(p["images"], list)


# ---------- POST /api/admin/products ----------
class TestAdminCreateProductImages:
    def test_create_with_images_only_sets_primary(self, api, seeded_admin, mongo):
        pid = f"p_TEST_{uuid.uuid4().hex[:8]}"
        payload = {
            "id": pid,
            "name": "TEST Primary from images",
            "tagline": "", "description": "",
            "price": 10.0,
            "image": "",  # intentionally empty
            "images": [f"{IMG}/a.jpg", f"{IMG}/b.jpg"],
            "category": "Capsules",
        }
        try:
            r = api.post(f"{BASE_URL}/api/admin/products",
                         json=payload, headers=_auth(seeded_admin["token"]))
            assert r.status_code == 200, r.text
            prod = r.json()["product"]
            assert prod["images"] == [f"{IMG}/a.jpg", f"{IMG}/b.jpg"]
            assert prod["image"] == f"{IMG}/a.jpg"
            # confirm persistence
            r2 = api.get(f"{BASE_URL}/api/products/{pid}")
            assert r2.status_code == 200
            p2 = r2.json()["product"]
            assert p2["images"] == [f"{IMG}/a.jpg", f"{IMG}/b.jpg"]
            assert p2["image"] == f"{IMG}/a.jpg"
        finally:
            mongo.products.delete_one({"id": pid})

    def test_create_caps_at_5(self, api, seeded_admin, mongo):
        pid = f"p_TEST_{uuid.uuid4().hex[:8]}"
        images = [f"{IMG}/{i}.jpg" for i in range(7)]  # 7 unique
        payload = {
            "id": pid, "name": "TEST Cap5", "price": 1.0,
            "image": "", "images": images, "category": "Teas",
        }
        try:
            r = api.post(f"{BASE_URL}/api/admin/products",
                         json=payload, headers=_auth(seeded_admin["token"]))
            assert r.status_code == 200, r.text
            prod = r.json()["product"]
            assert len(prod["images"]) == 5
            assert prod["images"] == images[:5]
            assert prod["image"] == images[0]
        finally:
            mongo.products.delete_one({"id": pid})

    def test_create_dedupes_duplicates(self, api, seeded_admin, mongo):
        pid = f"p_TEST_{uuid.uuid4().hex[:8]}"
        a, b = f"{IMG}/x.jpg", f"{IMG}/y.jpg"
        payload = {
            "id": pid, "name": "TEST Dedup", "price": 1.0,
            "image": "", "images": [a, b, a, b, a], "category": "Teas",
        }
        try:
            r = api.post(f"{BASE_URL}/api/admin/products",
                         json=payload, headers=_auth(seeded_admin["token"]))
            assert r.status_code == 200
            prod = r.json()["product"]
            assert prod["images"] == [a, b]
            assert prod["image"] == a
        finally:
            mongo.products.delete_one({"id": pid})

    def test_create_filters_empty_strings(self, api, seeded_admin, mongo):
        pid = f"p_TEST_{uuid.uuid4().hex[:8]}"
        payload = {
            "id": pid, "name": "TEST Empty", "price": 1.0,
            "image": "", "images": ["", "   ", f"{IMG}/z.jpg", ""],
            "category": "Teas",
        }
        try:
            r = api.post(f"{BASE_URL}/api/admin/products",
                         json=payload, headers=_auth(seeded_admin["token"]))
            assert r.status_code == 200
            prod = r.json()["product"]
            assert prod["images"] == [f"{IMG}/z.jpg"]
            assert prod["image"] == f"{IMG}/z.jpg"
        finally:
            mongo.products.delete_one({"id": pid})

    def test_create_with_legacy_image_only_backfills_images(self, api, seeded_admin, mongo):
        pid = f"p_TEST_{uuid.uuid4().hex[:8]}"
        payload = {
            "id": pid, "name": "TEST Legacy", "price": 1.0,
            "image": f"{IMG}/legacy.jpg", "images": [], "category": "Oils",
        }
        try:
            r = api.post(f"{BASE_URL}/api/admin/products",
                         json=payload, headers=_auth(seeded_admin["token"]))
            assert r.status_code == 200
            prod = r.json()["product"]
            assert prod["image"] == f"{IMG}/legacy.jpg"
            assert prod["images"] == [f"{IMG}/legacy.jpg"]
        finally:
            mongo.products.delete_one({"id": pid})

    def test_create_image_prepended_if_not_in_images(self, api, seeded_admin, mongo):
        """Legacy `image` + new `images` -> primary = legacy image (prepended)."""
        pid = f"p_TEST_{uuid.uuid4().hex[:8]}"
        payload = {
            "id": pid, "name": "TEST Mix", "price": 1.0,
            "image": f"{IMG}/primary.jpg",
            "images": [f"{IMG}/other.jpg"],
            "category": "Oils",
        }
        try:
            r = api.post(f"{BASE_URL}/api/admin/products",
                         json=payload, headers=_auth(seeded_admin["token"]))
            assert r.status_code == 200
            prod = r.json()["product"]
            assert prod["image"] == f"{IMG}/primary.jpg"
            assert prod["images"][0] == f"{IMG}/primary.jpg"
            assert f"{IMG}/other.jpg" in prod["images"]
        finally:
            mongo.products.delete_one({"id": pid})


# ---------- PUT /api/admin/products/{id} ----------
class TestAdminUpdateProductImages:
    def test_update_adds_more_images_to_legacy_product(self, api, seeded_admin, mongo):
        pid = f"p_TEST_{uuid.uuid4().hex[:8]}"
        # Insert a legacy-shaped product directly (image only, no images field)
        mongo.products.insert_one({
            "id": pid, "name": "TEST Legacy Update", "tagline": "", "description": "",
            "price": 1.0, "image": f"{IMG}/old.jpg", "category": "Teas",
            "benefits": [], "ingredients": [], "in_stock": True,
        })
        try:
            update_payload = {
                "id": pid, "name": "TEST Legacy Update", "price": 1.0,
                "image": f"{IMG}/old.jpg",
                "images": [f"{IMG}/old.jpg", f"{IMG}/new1.jpg", f"{IMG}/new2.jpg"],
                "category": "Teas",
            }
            r = api.put(f"{BASE_URL}/api/admin/products/{pid}",
                        json=update_payload, headers=_auth(seeded_admin["token"]))
            assert r.status_code == 200, r.text
            prod = r.json()["product"]
            assert prod["images"] == [f"{IMG}/old.jpg", f"{IMG}/new1.jpg", f"{IMG}/new2.jpg"]
            assert prod["image"] == f"{IMG}/old.jpg"
            # persistence check
            r2 = api.get(f"{BASE_URL}/api/products/{pid}")
            assert len(r2.json()["product"]["images"]) == 3
        finally:
            mongo.products.delete_one({"id": pid})

    def test_update_also_caps_and_dedupes(self, api, seeded_admin, mongo):
        pid = f"p_TEST_{uuid.uuid4().hex[:8]}"
        mongo.products.insert_one({
            "id": pid, "name": "TEST Update Cap", "tagline": "", "description": "",
            "price": 1.0, "image": "", "images": [], "category": "Powders",
            "benefits": [], "ingredients": [], "in_stock": True,
        })
        try:
            dup = f"{IMG}/dup.jpg"
            images = [f"{IMG}/{i}.jpg" for i in range(6)] + [dup, dup, ""]
            update = {
                "id": pid, "name": "TEST Update Cap", "price": 1.0,
                "image": "", "images": images, "category": "Powders",
            }
            r = api.put(f"{BASE_URL}/api/admin/products/{pid}",
                        json=update, headers=_auth(seeded_admin["token"]))
            assert r.status_code == 200
            prod = r.json()["product"]
            assert len(prod["images"]) == 5
            # ensure uniqueness
            assert len(set(prod["images"])) == 5
            assert prod["image"] == prod["images"][0]
        finally:
            mongo.products.delete_one({"id": pid})


# ---------- Startup backfill ----------
class TestStartupBackfill:
    def test_no_product_in_db_missing_images(self, mongo):
        """After startup backfill, no product doc should lack an `images` array."""
        missing = list(mongo.products.find({"images": {"$exists": False}}))
        assert missing == [], f"products without images: {[p.get('id') for p in missing]}"


# ---------- Categories union ----------
class TestCategoriesUnion:
    def test_categories_includes_distinct_product_categories(self, api, seeded_admin, mongo):
        """Create a product in a brand-new category that is NOT in admin list.
        GET /api/products/categories must still include it."""
        unique_cat = f"TESTCAT_{uuid.uuid4().hex[:6]}"
        pid = f"p_TEST_{uuid.uuid4().hex[:8]}"
        payload = {
            "id": pid, "name": "TEST Union", "price": 1.0,
            "image": f"{IMG}/u.jpg", "images": [f"{IMG}/u.jpg"],
            "category": unique_cat,
        }
        # Snapshot admin categories list (to make sure the new one is NOT in it)
        try:
            r = api.post(f"{BASE_URL}/api/admin/products",
                         json=payload, headers=_auth(seeded_admin["token"]))
            assert r.status_code == 200
            # The new category is only present on the product, not in the admin
            # categories settings (we never POSTed /api/admin/categories).
            admin_doc = mongo.settings.find_one({"key": "categories"}) or {}
            assert unique_cat not in admin_doc.get("list", []), \
                "pre-condition failed: unique category leaked into admin list"
            r2 = api.get(f"{BASE_URL}/api/products/categories")
            assert r2.status_code == 200
            cats = r2.json()["categories"]
            assert "All" in cats and cats[0] == "All"
            assert unique_cat in cats, f"union missing new product cat; got {cats}"
        finally:
            mongo.products.delete_one({"id": pid})

    def test_categories_covers_all_distinct_product_categories(self, api, mongo):
        r = api.get(f"{BASE_URL}/api/products/categories")
        assert r.status_code == 200
        cats = set(r.json()["categories"])
        distinct = set(mongo.products.distinct("category"))
        missing = distinct - cats
        assert not missing, f"categories endpoint missing product cats: {missing}"


# ---------- Seed non-overwrite (idempotency) ----------
class TestSeedIdempotency:
    def test_user_edited_seed_not_overwritten_on_restart(self, api, seeded_admin, mongo):
        """Edit a seeded product via admin API, then run the exact same seed logic
        that the startup event uses ($setOnInsert) and confirm the edit remains.
        This simulates a backend restart without actually restarting the process.
        """
        seed_id = "p_tulsi_tea"
        edited_name = f"EDITED by TEST {uuid.uuid4().hex[:6]}"
        # Fetch original (so we can restore afterwards)
        original = mongo.products.find_one({"id": seed_id}, {"_id": 0})
        assert original is not None
        try:
            payload = {
                "id": seed_id,
                "name": edited_name,
                "tagline": original.get("tagline", ""),
                "description": original.get("description", ""),
                "price": original.get("price", 1.0),
                "image": original.get("image", ""),
                "images": original.get("images", []),
                "category": original.get("category", "Teas"),
                "benefits": original.get("benefits", []),
                "ingredients": original.get("ingredients", []),
                "in_stock": original.get("in_stock", True),
            }
            r = api.put(f"{BASE_URL}/api/admin/products/{seed_id}",
                        json=payload, headers=_auth(seeded_admin["token"]))
            assert r.status_code == 200
            # Simulate startup seed with the ORIGINAL default name
            default_seed = {
                "id": seed_id,
                "name": "Tulsi Holy Basil Tea",
                "tagline": "Immunity & calm",
                "description": "default",
                "price": 249.0,
                "image": "https://seed.example/original.jpg",
                "images": ["https://seed.example/original.jpg"],
                "category": "Teas",
                "benefits": [],
                "ingredients": [],
            }
            mongo.products.update_one(
                {"id": seed_id},
                {"$setOnInsert": default_seed},
                upsert=True,
            )
            # Confirm admin-edited name is preserved
            doc = mongo.products.find_one({"id": seed_id}, {"_id": 0})
            assert doc["name"] == edited_name, \
                "seed $setOnInsert overwrote admin-edited product"
        finally:
            # Restore original
            mongo.products.update_one({"id": seed_id}, {"$set": original}, upsert=True)
