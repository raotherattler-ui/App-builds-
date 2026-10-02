"""Tests for /api/upload and /api/files/{path} (Emergent Managed Object Storage)."""
import os
import io
import struct
import zlib
import uuid
import pytest
import requests
from conftest import auth_headers, BASE_URL


def _tiny_png_bytes() -> bytes:
    """Return the smallest valid 1x1 red PNG (avoid 402 on storage quota)."""
    def chunk(ctype: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"  # filter byte + RGB
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


PNG_BYTES = _tiny_png_bytes()


# ---------- UPLOAD AUTH GATING ----------
class TestUploadAuth:
    def test_upload_no_token_returns_401(self, api):
        r = requests.post(
            f"{BASE_URL}/api/upload",
            files={"file": ("x.png", PNG_BYTES, "image/png")},
        )
        assert r.status_code == 401, r.text

    def test_upload_non_admin_returns_403(self, seeded_user):
        r = requests.post(
            f"{BASE_URL}/api/upload",
            files={"file": ("x.png", PNG_BYTES, "image/png")},
            headers={"Authorization": f"Bearer {seeded_user['token']}"},
        )
        assert r.status_code == 403, r.text

    def test_upload_admin_returns_200_and_shape(self, seeded_admin):
        r = requests.post(
            f"{BASE_URL}/api/upload",
            files={"file": ("x.png", PNG_BYTES, "image/png")},
            headers={"Authorization": f"Bearer {seeded_admin['token']}"},
        )
        if r.status_code in (402, 503):
            pytest.skip(f"Storage unavailable: {r.status_code} {r.text}")
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("path", "url", "relative_url", "size"):
            assert k in body, f"missing field {k}"
        # path pattern: avr-organics/uploads/{user_id}/{uuid}.{ext}
        parts = body["path"].split("/")
        assert parts[0] == "avr-organics"
        assert parts[1] == "uploads"
        assert parts[2] == seeded_admin["user_id"]
        assert parts[3].endswith(".png")
        assert body["size"] == len(PNG_BYTES)
        assert "token=" in body["relative_url"]


# ---------- UPLOAD VALIDATION ----------
class TestUploadValidation:
    def test_empty_body_returns_400(self, seeded_admin):
        r = requests.post(
            f"{BASE_URL}/api/upload",
            files={"file": ("empty.png", b"", "image/png")},
            headers={"Authorization": f"Bearer {seeded_admin['token']}"},
        )
        assert r.status_code == 400, r.text

    def test_non_image_content_type_returns_400(self, seeded_admin):
        r = requests.post(
            f"{BASE_URL}/api/upload",
            files={"file": ("file.pdf", b"%PDF-1.4\n%EOF", "application/pdf")},
            headers={"Authorization": f"Bearer {seeded_admin['token']}"},
        )
        assert r.status_code == 400, r.text

    def test_oversize_returns_413(self, seeded_admin):
        big = b"\x00" * (8 * 1024 * 1024 + 10)
        r = requests.post(
            f"{BASE_URL}/api/upload",
            files={"file": ("big.png", big, "image/png")},
            headers={"Authorization": f"Bearer {seeded_admin['token']}"},
        )
        assert r.status_code == 413, r.text


# ---------- DOWNLOAD ----------
@pytest.fixture(scope="module")
def uploaded(seeded_admin, mongo):
    """Upload one tiny PNG, yield metadata, then clean up."""
    r = requests.post(
        f"{BASE_URL}/api/upload",
        files={"file": ("x.png", PNG_BYTES, "image/png")},
        headers={"Authorization": f"Bearer {seeded_admin['token']}"},
    )
    if r.status_code in (402, 503):
        pytest.skip(f"Storage unavailable: {r.status_code}")
    assert r.status_code == 200, r.text
    body = r.json()
    doc = mongo.uploads.find_one({"path": body["path"]})
    assert doc, "upload row not written in uploads collection"
    public_token = doc["public_token"]
    yield {"path": body["path"], "token": public_token, "relative_url": body["relative_url"]}
    # cleanup
    mongo.uploads.delete_one({"path": body["path"]})
    mongo.products.delete_many({"id": {"$regex": "^p_TEST_upl_"}})


class TestDownload:
    def test_download_via_token_no_auth(self, uploaded):
        r = requests.get(f"{BASE_URL}/api/files/{uploaded['path']}", params={"token": uploaded["token"]})
        assert r.status_code == 200, r.text
        assert r.headers.get("Content-Type", "").startswith("image/")
        assert r.content == PNG_BYTES

    def test_download_via_bearer(self, uploaded, seeded_user):
        # Any valid session should work (admin or user)
        r = requests.get(
            f"{BASE_URL}/api/files/{uploaded['path']}",
            headers={"Authorization": f"Bearer {seeded_user['token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.content == PNG_BYTES

    def test_download_no_token_no_auth_returns_401(self, uploaded):
        r = requests.get(f"{BASE_URL}/api/files/{uploaded['path']}")
        assert r.status_code == 401, r.text

    def test_download_public_when_product_uses_it(self, uploaded, seeded_admin, mongo):
        # Create a product whose image contains the uploaded path
        pid = f"p_TEST_upl_{uuid.uuid4().hex[:8]}"
        image_url = f"{BASE_URL}/api/files/{uploaded['path']}?token={uploaded['token']}"
        payload = {
            "id": pid,
            "name": "TEST Upload Product",
            "tagline": "test",
            "description": "test",
            "price": 100.0,
            "image": image_url,
            "category": "Capsules",
            "benefits": [],
            "ingredients": [],
            "in_stock": True,
        }
        cr = requests.post(
            f"{BASE_URL}/api/admin/products",
            json=payload,
            headers=auth_headers(seeded_admin["token"]),
        )
        assert cr.status_code == 200, cr.text
        try:
            # Unauthenticated, no token — must succeed because product references it
            r = requests.get(f"{BASE_URL}/api/files/{uploaded['path']}")
            assert r.status_code == 200, r.text
            assert r.content == PNG_BYTES
        finally:
            requests.delete(
                f"{BASE_URL}/api/admin/products/{pid}",
                headers=auth_headers(seeded_admin["token"]),
            )

    def test_download_unknown_path_returns_404(self):
        r = requests.get(f"{BASE_URL}/api/files/avr-organics/uploads/nope/does-not-exist.png", params={"token": "x"})
        assert r.status_code == 404, r.text
