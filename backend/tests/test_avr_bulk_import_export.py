# Tests for the new AVR Organics bulk-export / bulk-import admin endpoints
# Covers: auth gating, happy path import, dup-by-name skip, overwrite, invalid entries
# into errors[], image normalization (dedup/cap-5/primary), category merge, export shape.
import uuid
import pytest
from conftest import auth_headers


# ---------- Auth gating ----------
class TestAuthGating:
    def test_export_requires_auth(self, api, base_url):
        r = api.get(f"{base_url}/api/admin/products/export")
        assert r.status_code == 401

    def test_export_rejects_non_admin(self, api, base_url, seeded_user):
        r = api.get(
            f"{base_url}/api/admin/products/export",
            headers=auth_headers(seeded_user["token"]),
        )
        assert r.status_code == 403

    def test_bulk_import_requires_auth(self, api, base_url):
        r = api.post(f"{base_url}/api/admin/products/bulk-import", json={"products": []})
        assert r.status_code == 401

    def test_bulk_import_rejects_non_admin(self, api, base_url, seeded_user):
        r = api.post(
            f"{base_url}/api/admin/products/bulk-import",
            json={"products": []},
            headers=auth_headers(seeded_user["token"]),
        )
        assert r.status_code == 403


# ---------- Export shape ----------
class TestExport:
    def test_export_returns_products_categories_count(self, api, base_url, seeded_admin):
        r = api.get(
            f"{base_url}/api/admin/products/export",
            headers=auth_headers(seeded_admin["token"]),
        )
        assert r.status_code == 200
        body = r.json()
        assert set(["products", "categories", "count"]).issubset(body.keys())
        assert isinstance(body["products"], list)
        assert isinstance(body["categories"], list)
        assert body["count"] == len(body["products"])
        # No Mongo _id leakage
        for p in body["products"]:
            assert "_id" not in p


# ---------- Bulk import ----------
class TestBulkImport:
    def _unique(self, n=3):
        tag = uuid.uuid4().hex[:6]
        return [
            {
                "name": f"TEST_bulk_{tag}_{i}",
                "price": 100 + i,
                "category": "TestBulkCat",
                "image": f"https://img.example/{tag}_{i}.jpg",
            }
            for i in range(n)
        ]

    def _cleanup(self, mongo, prefix):
        mongo.products.delete_many({"name": {"$regex": f"^{prefix}"}})

    def test_import_three_unique(self, api, base_url, seeded_admin, mongo):
        prefix = f"TEST_bulk_u_{uuid.uuid4().hex[:4]}"
        prods = [
            {"name": f"{prefix}_{i}", "price": 100.0 + i, "category": "TestBulkCat"}
            for i in range(3)
        ]
        try:
            r = api.post(
                f"{base_url}/api/admin/products/bulk-import",
                json={"products": prods},
                headers=auth_headers(seeded_admin["token"]),
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["imported"] == 3
            assert body["skipped_existing"] == 0
            assert body["overwritten"] == 0
            assert body["errors"] == []
            # Verify persistence
            count = mongo.products.count_documents({"name": {"$regex": f"^{prefix}"}})
            assert count == 3
        finally:
            self._cleanup(mongo, prefix)

    def test_import_skips_existing_by_name(self, api, base_url, seeded_admin, mongo):
        prefix = f"TEST_bulk_s_{uuid.uuid4().hex[:4]}"
        # Pre-create one
        mongo.products.insert_one({
            "id": f"p_pre_{uuid.uuid4().hex[:8]}",
            "name": f"{prefix}_0",
            "price": 50.0,
            "category": "TestBulkCat",
            "image": "",
            "images": [],
        })
        prods = [
            {"name": f"{prefix}_0", "price": 999.0, "category": "TestBulkCat"},
            {"name": f"{prefix}_1", "price": 101.0, "category": "TestBulkCat"},
            {"name": f"{prefix}_2", "price": 102.0, "category": "TestBulkCat"},
        ]
        try:
            r = api.post(
                f"{base_url}/api/admin/products/bulk-import",
                json={"products": prods, "overwrite": False},
                headers=auth_headers(seeded_admin["token"]),
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["imported"] == 2
            assert body["skipped_existing"] == 1
            assert body["overwritten"] == 0
            # Confirm old price kept (not overwritten)
            kept = mongo.products.find_one({"name": f"{prefix}_0"})
            assert kept["price"] == 50.0
        finally:
            self._cleanup(mongo, prefix)

    def test_import_overwrite_true_replaces(self, api, base_url, seeded_admin, mongo):
        prefix = f"TEST_bulk_o_{uuid.uuid4().hex[:4]}"
        mongo.products.insert_one({
            "id": f"p_pre_{uuid.uuid4().hex[:8]}",
            "name": f"{prefix}_0",
            "price": 50.0,
            "category": "TestBulkCat",
            "image": "",
            "images": [],
        })
        prods = [
            {"name": f"{prefix}_0", "price": 999.0, "category": "TestBulkCat",
             "image": "https://img.example/new.jpg"},
        ]
        try:
            r = api.post(
                f"{base_url}/api/admin/products/bulk-import",
                json={"products": prods, "overwrite": True},
                headers=auth_headers(seeded_admin["token"]),
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["overwritten"] == 1
            assert body["skipped_existing"] == 0
            assert body["imported"] == 0
            updated = mongo.products.find_one({"name": f"{prefix}_0"})
            assert updated["price"] == 999.0
            assert updated["image"] == "https://img.example/new.jpg"
        finally:
            self._cleanup(mongo, prefix)

    def test_invalid_entries_go_to_errors(self, api, base_url, seeded_admin, mongo):
        """Spec: items without a name should go into errors[] without crashing."""
        prefix = f"TEST_bulk_e_{uuid.uuid4().hex[:4]}"
        prods = [
            {"name": f"{prefix}_ok", "price": 10.0, "category": "TestBulkCat"},
            {"price": 20.0, "category": "NoName"},  # missing name
            {"name": "", "price": 30.0},  # empty name
            {"name": None, "price": 40.0},  # null name
        ]
        try:
            r = api.post(
                f"{base_url}/api/admin/products/bulk-import",
                json={"products": prods},
                headers=auth_headers(seeded_admin["token"]),
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["imported"] == 1
            assert len(body["errors"]) == 3, f"errors was: {body['errors']}"
        finally:
            self._cleanup(mongo, prefix)

    def test_import_normalizes_images(self, api, base_url, seeded_admin, mongo):
        prefix = f"TEST_bulk_i_{uuid.uuid4().hex[:4]}"
        prods = [{
            "name": f"{prefix}_imgs",
            "price": 100.0,
            "category": "TestBulkCat",
            "image": "https://img.example/primary.jpg",
            "images": [
                "https://img.example/primary.jpg",  # dup of primary
                "https://img.example/a.jpg",
                "https://img.example/a.jpg",  # dup
                "https://img.example/b.jpg",
                "https://img.example/c.jpg",
                "https://img.example/d.jpg",
                "https://img.example/e.jpg",
                "https://img.example/f.jpg",  # beyond 5
                "",
                "   ",
            ],
        }]
        try:
            r = api.post(
                f"{base_url}/api/admin/products/bulk-import",
                json={"products": prods},
                headers=auth_headers(seeded_admin["token"]),
            )
            assert r.status_code == 200, r.text
            doc = mongo.products.find_one({"name": f"{prefix}_imgs"})
            assert doc is not None
            assert len(doc["images"]) == 5
            assert doc["image"] == doc["images"][0]
            assert doc["image"] == "https://img.example/primary.jpg"
            # No duplicates in images
            assert len(set(doc["images"])) == 5
            # No empty strings
            assert all(u.strip() for u in doc["images"])
        finally:
            self._cleanup(mongo, prefix)

    def test_import_merges_categories(self, api, base_url, seeded_admin, mongo):
        prefix = f"TEST_bulk_c_{uuid.uuid4().hex[:4]}"
        new_cat_1 = f"TEST_CAT_{uuid.uuid4().hex[:6]}"
        new_cat_2 = f"TEST_CAT_{uuid.uuid4().hex[:6]}"
        # Snapshot current categories
        s = mongo.settings.find_one({"key": "categories"}) or {"list": []}
        before = list(s.get("list", []))
        try:
            r = api.post(
                f"{base_url}/api/admin/products/bulk-import",
                json={
                    "products": [{
                        "name": f"{prefix}_1",
                        "price": 1.0,
                        "category": new_cat_1,
                    }],
                    "categories": [new_cat_1, new_cat_2, "   ", ""],
                },
                headers=auth_headers(seeded_admin["token"]),
            )
            assert r.status_code == 200, r.text
            after = mongo.settings.find_one({"key": "categories"})["list"]
            assert new_cat_1 in after
            assert new_cat_2 in after
            # No empty entries added
            assert "" not in after
            assert "   " not in after
        finally:
            self._cleanup(mongo, prefix)
            # restore categories list
            mongo.settings.update_one(
                {"key": "categories"},
                {"$set": {"key": "categories", "list": before}},
                upsert=True,
            )


# ---------- Export → re-import round-trip ----------
class TestExportImportRoundTrip:
    def test_export_then_bulk_import_is_idempotent_default(self, api, base_url, seeded_admin):
        exp = api.get(
            f"{base_url}/api/admin/products/export",
            headers=auth_headers(seeded_admin["token"]),
        ).json()
        imp = api.post(
            f"{base_url}/api/admin/products/bulk-import",
            json={"products": exp["products"], "categories": exp["categories"]},
            headers=auth_headers(seeded_admin["token"]),
        )
        assert imp.status_code == 200, imp.text
        body = imp.json()
        # Everything should be skipped since all already exist (default overwrite=false)
        assert body["imported"] == 0
        assert body["overwritten"] == 0
        assert body["skipped_existing"] == exp["count"]
