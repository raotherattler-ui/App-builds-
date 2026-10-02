from fastapi import FastAPI, APIRouter, HTTPException, Header, Request, UploadFile, File, Response, Query
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import logging
import uuid
import hmac
import hashlib
import httpx
import requests
import secrets
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta

try:
    import razorpay  # type: ignore
except Exception:  # pragma: no cover
    razorpay = None

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

RAZORPAY_KEY_ID = os.environ.get('RAZORPAY_KEY_ID', '')
RAZORPAY_KEY_SECRET = os.environ.get('RAZORPAY_KEY_SECRET', '')
DEFAULT_SUPPORT_EMAIL = os.environ.get('SUPPORT_EMAIL', 'support@herbalbloom.app')
DEFAULT_SUPPORT_WHATSAPP = os.environ.get('SUPPORT_WHATSAPP', '+919677337727')
ADMIN_EMAILS = [e.strip().lower() for e in os.environ.get('ADMIN_EMAILS', '').split(',') if e.strip()]

razor_client = None
if razorpay and RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET:
    razor_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

# ---------- Object storage (Emergent Managed) ----------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
APP_NAME = "avr-organics"
_storage_key: Optional[str] = None


def _init_storage() -> Optional[str]:
    """Call once at startup. Idempotent."""
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_KEY:
        return None
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        r.raise_for_status()
        _storage_key = r.json()["storage_key"]
        return _storage_key
    except Exception as e:
        logging.getLogger(__name__).warning(f"storage init failed: {e}")
        return None


def _put_object(path: str, data: bytes, content_type: str) -> dict:
    key = _init_storage()
    if not key:
        raise HTTPException(503, "Storage not configured")
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if r.status_code == 503:
        # stale key — reinit once
        global _storage_key
        _storage_key = None
        key = _init_storage()
        if not key:
            raise HTTPException(503, "Storage unavailable")
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    if r.status_code == 402:
        raise HTTPException(402, "Storage credit limit reached — contact support.")
    r.raise_for_status()
    return r.json()


def _get_object(path: str) -> tuple[bytes, str]:
    key = _init_storage()
    if not key:
        raise HTTPException(503, "Storage not configured")
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if r.status_code == 500:
        raise HTTPException(404, "Not found")
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------- Models ----------
class Product(BaseModel):
    id: str
    name: str
    tagline: str
    description: str
    price: float  # in INR
    image: str
    category: str
    benefits: List[str] = []
    ingredients: List[str] = []
    in_stock: bool = True


class CartItem(BaseModel):
    product_id: str
    quantity: int


class CartAddRequest(BaseModel):
    product_id: str
    quantity: int = 1


class CartUpdateRequest(BaseModel):
    product_id: str
    quantity: int


class CheckoutAddress(BaseModel):
    full_name: str
    phone: str
    line1: str
    city: str
    state: str
    pincode: str


class OrderCreateRequest(BaseModel):
    address: CheckoutAddress
    payment_method: str = "upi"  # "upi", "cod", "razorpay"


class PaymentVerifyRequest(BaseModel):
    order_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class ReviewCreateRequest(BaseModel):
    product_id: str
    rating: int  # 1..5
    comment: str = ""


class AuthSessionRequest(BaseModel):
    session_id: str


# ---------- Auth helpers ----------
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session.get("expires_at")
    if exp:
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ---------- Auth Endpoints ----------
@api_router.post("/auth/session")
async def auth_session(payload: AuthSessionRequest):
    async with httpx.AsyncClient(timeout=15) as h:
        r = await h.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": payload.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session id")
    data = r.json()
    email = data["email"]
    name = data.get("name", email.split("@")[0])
    picture = data.get("picture", "")
    session_token = data["session_token"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        # Promote to admin if listed in ADMIN_EMAILS env
        upd = {"name": name, "picture": picture}
        if email.lower() in ADMIN_EMAILS and not existing.get("is_admin"):
            upd["is_admin"] = True
        await db.users.update_one({"user_id": user_id}, {"$set": upd})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        # First-ever user OR listed in ADMIN_EMAILS becomes admin
        user_count = await db.users.count_documents({})
        is_admin = user_count == 0 or email.lower() in ADMIN_EMAILS
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "is_admin": is_admin,
            "created_at": datetime.now(timezone.utc),
        })

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_id,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )

    user_obj = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": user_obj}


@api_router.get("/auth/me")
async def auth_me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return {"user": user}


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- Products ----------
@api_router.get("/products")
async def list_products(category: Optional[str] = None):
    q = {}
    if category and category != "All":
        q["category"] = category
    docs = await db.products.find(q, {"_id": 0}).to_list(500)
    # attach average rating
    for d in docs:
        agg = await db.reviews.aggregate([
            {"$match": {"product_id": d["id"]}},
            {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
        ]).to_list(1)
        d["avg_rating"] = round(agg[0]["avg"], 1) if agg else 0
        d["rating_count"] = agg[0]["count"] if agg else 0
    return {"products": docs}


@api_router.get("/products/categories")
async def categories():
    # Admin-managed list, fallback to distinct from products
    s = await db.settings.find_one({"key": "categories"}, {"_id": 0})
    if s and isinstance(s.get("list"), list) and s["list"]:
        return {"categories": ["All"] + s["list"]}
    cats = await db.products.distinct("category")
    return {"categories": ["All"] + sorted(cats)}


@api_router.get("/products/{product_id}")
async def get_product(product_id: str):
    doc = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Product not found")
    agg = await db.reviews.aggregate([
        {"$match": {"product_id": product_id}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    doc["avg_rating"] = round(agg[0]["avg"], 1) if agg else 0
    doc["rating_count"] = agg[0]["count"] if agg else 0
    return {"product": doc}


# ---------- Cart ----------
@api_router.get("/cart")
async def get_cart(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    cart = await db.carts.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {"user_id": user["user_id"], "items": []}
    # join with product info
    items = []
    subtotal = 0.0
    for it in cart.get("items", []):
        p = await db.products.find_one({"id": it["product_id"]}, {"_id": 0})
        if p:
            items.append({**it, "product": p})
            subtotal += p["price"] * it["quantity"]
    return {"items": items, "subtotal": round(subtotal, 2)}


@api_router.post("/cart/add")
async def cart_add(req: CartAddRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    cart = await db.carts.find_one({"user_id": user["user_id"]}) or {"user_id": user["user_id"], "items": []}
    items = cart.get("items", [])
    found = False
    for it in items:
        if it["product_id"] == req.product_id:
            it["quantity"] += req.quantity
            found = True
            break
    if not found:
        items.append({"product_id": req.product_id, "quantity": req.quantity})
    await db.carts.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"items": items}},
        upsert=True,
    )
    return {"ok": True}


@api_router.post("/cart/update")
async def cart_update(req: CartUpdateRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    cart = await db.carts.find_one({"user_id": user["user_id"]}) or {"user_id": user["user_id"], "items": []}
    items = [it for it in cart.get("items", []) if it["product_id"] != req.product_id]
    if req.quantity > 0:
        items.append({"product_id": req.product_id, "quantity": req.quantity})
    await db.carts.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"items": items}},
        upsert=True,
    )
    return {"ok": True}


@api_router.post("/cart/clear")
async def cart_clear(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.carts.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"items": []}},
        upsert=True,
    )
    return {"ok": True}


# ---------- Orders & Payments ----------
@api_router.post("/orders/create")
async def create_order(req: OrderCreateRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    cart = await db.carts.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not cart or not cart.get("items"):
        raise HTTPException(400, "Cart is empty")
    items = []
    subtotal = 0.0
    for it in cart["items"]:
        p = await db.products.find_one({"id": it["product_id"]}, {"_id": 0})
        if not p:
            continue
        items.append({
            "product_id": p["id"],
            "name": p["name"],
            "image": p["image"],
            "price": p["price"],
            "quantity": it["quantity"],
        })
        subtotal += p["price"] * it["quantity"]
    if not items:
        raise HTTPException(400, "Cart empty")
    shipping = 0.0 if subtotal > 999 else 49.0
    total = round(subtotal + shipping, 2)

    order_id = f"ord_{uuid.uuid4().hex[:14]}"
    rzp_order_id = None
    merchant = await get_merchant_settings()

    if req.payment_method == "razorpay":
        if razor_client:
            try:
                rzp_order = razor_client.order.create({
                    "amount": int(total * 100),
                    "currency": "INR",
                    "receipt": order_id[:40],
                    "payment_capture": 1,
                })
                rzp_order_id = rzp_order["id"]
            except Exception as e:
                logger.warning(f"Razorpay order create failed: {e}")
                rzp_order_id = f"mock_{uuid.uuid4().hex[:10]}"
        else:
            rzp_order_id = f"mock_{uuid.uuid4().hex[:10]}"

    # Build UPI deep link for direct-VPA payments
    upi_link = None
    if req.payment_method == "upi" and merchant["vpa"]:
        import urllib.parse as _u
        params = {
            "pa": merchant["vpa"],
            "pn": merchant["name"],
            "am": f"{total:.2f}",
            "cu": "INR",
            "tn": f"Order {order_id[-8:].upper()}",
            "tr": order_id[-12:],
        }
        upi_link = "upi://pay?" + _u.urlencode(params)

    now = datetime.now(timezone.utc)
    doc = {
        "id": order_id,
        "user_id": user["user_id"],
        "user_email": user.get("email", ""),
        "user_name": user.get("name", ""),
        "items": items,
        "address": req.address.model_dump(),
        "subtotal": round(subtotal, 2),
        "shipping": shipping,
        "total": total,
        "payment_method": req.payment_method,
        "razorpay_order_id": rzp_order_id,
        "upi_link": upi_link,
        "merchant_vpa": merchant["vpa"] if req.payment_method == "upi" else None,
        "status": "pending",
        "status_history": [{"status": "pending", "at": now, "note": "Order placed"}],
        "created_at": now,
    }
    await db.orders.insert_one(doc)

    # Best-effort WhatsApp alert to admin (via CallMeBot if configured)
    try:
        oid_short = order_id[-8:].upper()
        item_lines = "\n".join(f"- {it['name']} x{it['quantity']}" for it in items[:5])
        more = f"\n+{len(items) - 5} more" if len(items) > 5 else ""
        alert_text = (
            f"NEW ORDER #{oid_short}\n"
            f"{user.get('name','Customer')} ({user.get('email','')})\n"
            f"Total: ₹{total:.2f} · {req.payment_method.upper()}\n"
            f"{item_lines}{more}\n"
            f"Deliver to: {req.address.full_name}, {req.address.city} - {req.address.pincode}\n"
            f"Phone: {req.address.phone}"
        )
        import asyncio as _asyncio
        _asyncio.create_task(send_whatsapp_alert(alert_text))
    except Exception as _e:
        logger.warning(f"whatsapp alert schedule failed: {_e}")

    return {
        "order_id": order_id,
        "razorpay_order_id": rzp_order_id,
        "razorpay_key_id": RAZORPAY_KEY_ID,
        "amount": int(total * 100),
        "currency": "INR",
        "total": total,
        "upi_link": upi_link,
        "merchant_vpa": merchant["vpa"] if req.payment_method == "upi" else None,
        "merchant_name": merchant["name"],
        "payment_method": req.payment_method,
    }


@api_router.post("/payments/verify")
async def verify_payment(req: PaymentVerifyRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    order = await db.orders.find_one({"id": req.order_id, "user_id": user["user_id"]}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")

    if RAZORPAY_KEY_SECRET and not req.razorpay_payment_id.startswith("mock_"):
        body = f"{req.razorpay_order_id}|{req.razorpay_payment_id}".encode()
        expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), body, hashlib.sha256).hexdigest()
        if expected != req.razorpay_signature:
            raise HTTPException(400, "Invalid signature")

    now = datetime.now(timezone.utc)
    await db.orders.update_one(
        {"id": req.order_id},
        {
            "$set": {
                "status": "paid",
                "razorpay_payment_id": req.razorpay_payment_id,
                "paid_at": now,
            },
            "$push": {"status_history": {"status": "paid", "at": now, "note": "Payment received"}},
        },
    )
    await db.carts.update_one({"user_id": user["user_id"]}, {"$set": {"items": []}}, upsert=True)
    return {"ok": True, "status": "paid"}


@api_router.post("/orders/{order_id}/mock-pay")
async def mock_pay(order_id: str, authorization: Optional[str] = Header(None)):
    """Simulate a successful payment when real Razorpay keys are not configured.
    Used only until live keys are added."""
    user = await get_current_user(authorization)
    order = await db.orders.find_one({"id": order_id, "user_id": user["user_id"]}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    now = datetime.now(timezone.utc)
    await db.orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "status": "paid",
                "razorpay_payment_id": f"mock_pay_{uuid.uuid4().hex[:10]}",
                "paid_at": now,
            },
            "$push": {"status_history": {"status": "paid", "at": now, "note": "Payment received"}},
        },
    )
    await db.carts.update_one({"user_id": user["user_id"]}, {"$set": {"items": []}}, upsert=True)
    return {"ok": True, "status": "paid"}


def _serialize_order(d: dict) -> dict:
    if isinstance(d.get("created_at"), datetime):
        d["created_at"] = d["created_at"].isoformat()
    if isinstance(d.get("paid_at"), datetime):
        d["paid_at"] = d["paid_at"].isoformat()
    hist = d.get("status_history") or []
    for h in hist:
        if isinstance(h.get("at"), datetime):
            h["at"] = h["at"].isoformat()
    d["status_history"] = hist
    return d


@api_router.get("/orders/me")
async def my_orders(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    docs = await db.orders.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    for d in docs:
        _serialize_order(d)
    return {"orders": docs}


@api_router.get("/orders/{order_id}")
async def get_order(order_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    d = await db.orders.find_one({"id": order_id, "user_id": user["user_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")
    _serialize_order(d)
    return {"order": d}


# ---------- Reviews ----------
@api_router.get("/products/{product_id}/reviews")
async def get_reviews(product_id: str):
    docs = await db.reviews.find({"product_id": product_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    for d in docs:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
    return {"reviews": docs}


@api_router.post("/reviews")
async def create_review(req: ReviewCreateRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if req.rating < 1 or req.rating > 5:
        raise HTTPException(400, "Rating must be 1-5")
    # ensure user has a paid order containing this product
    purchased = await db.orders.find_one({
        "user_id": user["user_id"],
        "status": "paid",
        "items.product_id": req.product_id,
    })
    if not purchased:
        raise HTTPException(403, "You can review only after purchasing this product")
    existing = await db.reviews.find_one({"product_id": req.product_id, "user_id": user["user_id"]})
    review = {
        "id": f"rev_{uuid.uuid4().hex[:12]}",
        "product_id": req.product_id,
        "user_id": user["user_id"],
        "user_name": user.get("name", "Customer"),
        "rating": req.rating,
        "comment": req.comment,
        "created_at": datetime.now(timezone.utc),
    }
    if existing:
        await db.reviews.update_one(
            {"product_id": req.product_id, "user_id": user["user_id"]},
            {"$set": {"rating": req.rating, "comment": req.comment, "created_at": review["created_at"]}},
        )
    else:
        await db.reviews.insert_one(review)
    return {"ok": True}


@api_router.get("/reviews/eligibility/{product_id}")
async def review_eligibility(product_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    purchased = await db.orders.find_one({
        "user_id": user["user_id"],
        "status": "paid",
        "items.product_id": product_id,
    })
    existing = await db.reviews.find_one({"product_id": product_id, "user_id": user["user_id"]}, {"_id": 0})
    if existing and isinstance(existing.get("created_at"), datetime):
        existing["created_at"] = existing["created_at"].isoformat()
    return {"eligible": bool(purchased), "existing_review": existing}


# ---------- Support ----------
async def get_support_settings() -> dict:
    s = await db.settings.find_one({"key": "support"}, {"_id": 0})
    if s:
        return {"email": s.get("email", DEFAULT_SUPPORT_EMAIL), "whatsapp": s.get("whatsapp", DEFAULT_SUPPORT_WHATSAPP)}
    return {"email": DEFAULT_SUPPORT_EMAIL, "whatsapp": DEFAULT_SUPPORT_WHATSAPP}


async def get_merchant_settings() -> dict:
    s = await db.settings.find_one({"key": "merchant"}, {"_id": 0})
    return {
        "vpa": (s or {}).get("vpa", ""),
        "name": (s or {}).get("name", "AVR Organics"),
    }


async def get_callmebot_settings() -> dict:
    s = await db.settings.find_one({"key": "callmebot"}, {"_id": 0})
    return {
        "phone": (s or {}).get("phone", ""),
        "apikey": (s or {}).get("apikey", ""),
    }


async def send_whatsapp_alert(text: str) -> dict:
    """Best-effort CallMeBot WhatsApp alert. Returns status dict; never raises."""
    cfg = await get_callmebot_settings()
    if not cfg["phone"] or not cfg["apikey"]:
        return {"sent": False, "reason": "CallMeBot not configured"}
    phone = cfg["phone"].replace("+", "").replace(" ", "").replace("-", "")
    try:
        async with httpx.AsyncClient(timeout=10) as h:
            r = await h.get(
                "https://api.callmebot.com/whatsapp.php",
                params={"phone": phone, "text": text, "apikey": cfg["apikey"]},
            )
        return {"sent": r.status_code == 200, "status": r.status_code}
    except Exception as e:
        logger.warning(f"CallMeBot send failed: {e}")
        return {"sent": False, "reason": str(e)}


@api_router.get("/support/info")
async def support_info():
    s = await get_support_settings()
    wp = s["whatsapp"].replace("+", "").replace(" ", "").replace("-", "")
    m = await get_merchant_settings()
    return {
        "email": s["email"],
        "whatsapp": s["whatsapp"],
        "whatsapp_link": f"https://wa.me/{wp}",
        "merchant_vpa": m["vpa"],
        "merchant_name": m["name"],
    }


class SupportUpdateRequest(BaseModel):
    email: str
    whatsapp: str


class MerchantUpdateRequest(BaseModel):
    vpa: str
    name: str


class CallMeBotUpdateRequest(BaseModel):
    phone: str
    apikey: str


async def require_admin(authorization: Optional[str]) -> dict:
    user = await get_current_user(authorization)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    return user


@api_router.put("/admin/support")
async def admin_update_support(req: SupportUpdateRequest, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    await db.settings.update_one(
        {"key": "support"},
        {"$set": {"key": "support", "email": req.email, "whatsapp": req.whatsapp}},
        upsert=True,
    )
    return {"ok": True}


@api_router.put("/admin/merchant")
async def admin_update_merchant(req: MerchantUpdateRequest, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    await db.settings.update_one(
        {"key": "merchant"},
        {"$set": {"key": "merchant", "vpa": req.vpa.strip(), "name": req.name.strip() or "AVR Organics"}},
        upsert=True,
    )
    return {"ok": True}


@api_router.get("/admin/callmebot")
async def admin_get_callmebot(authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    cfg = await get_callmebot_settings()
    return {"phone": cfg["phone"], "apikey_set": bool(cfg["apikey"]), "apikey": cfg["apikey"]}


@api_router.put("/admin/callmebot")
async def admin_update_callmebot(req: CallMeBotUpdateRequest, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    await db.settings.update_one(
        {"key": "callmebot"},
        {"$set": {"key": "callmebot", "phone": req.phone.strip(), "apikey": req.apikey.strip()}},
        upsert=True,
    )
    return {"ok": True}


@api_router.post("/admin/callmebot/test")
async def admin_test_callmebot(authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    r = await send_whatsapp_alert(
        f"Test message from AVR Organics admin panel. Hi {admin.get('name', 'Admin')}! Your WhatsApp alerts are working."
    )
    return r


# ---------- Admin: Products CRUD ----------
class ProductUpsertRequest(BaseModel):
    id: Optional[str] = None
    name: str
    tagline: str = ""
    description: str = ""
    price: float
    image: str
    category: str
    benefits: List[str] = []
    ingredients: List[str] = []
    in_stock: bool = True


@api_router.post("/admin/products")
async def admin_create_product(req: ProductUpsertRequest, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    pid = req.id or f"p_{uuid.uuid4().hex[:10]}"
    doc = req.model_dump()
    doc["id"] = pid
    await db.products.update_one({"id": pid}, {"$set": doc}, upsert=True)
    return {"ok": True, "product": doc}


@api_router.put("/admin/products/{product_id}")
async def admin_update_product(product_id: str, req: ProductUpsertRequest, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    doc = req.model_dump()
    doc["id"] = product_id
    await db.products.update_one({"id": product_id}, {"$set": doc}, upsert=True)
    return {"ok": True, "product": doc}


@api_router.delete("/admin/products/{product_id}")
async def admin_delete_product(product_id: str, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    await db.products.delete_one({"id": product_id})
    return {"ok": True}


# ---------- Admin: Categories ----------
class CategoryAddRequest(BaseModel):
    name: str


class CategoryRenameRequest(BaseModel):
    old_name: str
    new_name: str


async def _get_categories_list() -> List[str]:
    s = await db.settings.find_one({"key": "categories"}, {"_id": 0})
    if s and isinstance(s.get("list"), list):
        return s["list"]
    return sorted(await db.products.distinct("category"))


async def _set_categories_list(lst: List[str]):
    await db.settings.update_one(
        {"key": "categories"},
        {"$set": {"key": "categories", "list": lst}},
        upsert=True,
    )


@api_router.get("/admin/categories")
async def admin_list_categories(authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    return {"categories": await _get_categories_list()}


@api_router.post("/admin/categories")
async def admin_add_category(req: CategoryAddRequest, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "Empty name")
    lst = await _get_categories_list()
    if name not in lst:
        lst.append(name)
    await _set_categories_list(lst)
    return {"ok": True, "categories": lst}


@api_router.put("/admin/categories")
async def admin_rename_category(req: CategoryRenameRequest, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    new_name = req.new_name.strip()
    if not new_name:
        raise HTTPException(400, "Empty name")
    lst = await _get_categories_list()
    lst = [new_name if c == req.old_name else c for c in lst]
    # de-dup while preserving order
    seen: set = set()
    out: List[str] = []
    for c in lst:
        if c not in seen:
            seen.add(c)
            out.append(c)
    await _set_categories_list(out)
    # cascade rename on products
    await db.products.update_many({"category": req.old_name}, {"$set": {"category": new_name}})
    return {"ok": True, "categories": out}


@api_router.delete("/admin/categories/{name}")
async def admin_delete_category(name: str, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    lst = await _get_categories_list()
    lst = [c for c in lst if c != name]
    await _set_categories_list(lst)
    return {"ok": True, "categories": lst}


# ---------- Admin: Admins Management ----------
class PromoteAdminRequest(BaseModel):
    email: str


@api_router.get("/admin/admins")
async def admin_list_admins(authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    docs = await db.users.find({"is_admin": True}, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "picture": 1}).to_list(50)
    return {"admins": docs}


@api_router.post("/admin/admins")
async def admin_promote(req: PromoteAdminRequest, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    email = req.email.strip().lower()
    if not email:
        raise HTTPException(400, "Empty email")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        raise HTTPException(404, "No user with that email. They must sign in once before being promoted.")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"is_admin": True}})
    return {"ok": True}


@api_router.delete("/admin/admins/{user_id}")
async def admin_revoke(user_id: str, authorization: Optional[str] = Header(None)):
    current = await require_admin(authorization)
    if current["user_id"] == user_id:
        raise HTTPException(400, "You cannot remove your own admin role")
    # Prevent removing the last remaining admin
    count = await db.users.count_documents({"is_admin": True})
    if count <= 1:
        raise HTTPException(400, "At least one admin must remain")
    await db.users.update_one({"user_id": user_id}, {"$set": {"is_admin": False}})
    return {"ok": True}


# ---------- Image Upload (Admin only) ----------
_EXT_MAP = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
    "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
}


@api_router.post("/upload")
async def upload_image(file: UploadFile = File(...), authorization: Optional[str] = Header(None)):
    user = await require_admin(authorization)
    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(413, "File too large (8MB max)")
    ctype = (file.content_type or "image/jpeg").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(400, "Only image uploads are allowed")
    ext = _EXT_MAP.get(ctype, "bin")
    uid = uuid.uuid4().hex
    rel_path = f"{APP_NAME}/uploads/{user['user_id']}/{uid}.{ext}"
    await run_in_threadpool(_put_object, rel_path, content, ctype)
    token = secrets.token_urlsafe(16)
    await db.uploads.insert_one({
        "path": rel_path,
        "owner_id": user["user_id"],
        "content_type": ctype,
        "size": len(content),
        "public_token": token,
        "created_at": datetime.now(timezone.utc),
    })
    # Build an absolute URL the frontend can embed directly.
    backend_url = os.environ.get("PUBLIC_BACKEND_URL") or ""
    rel_url = f"/api/files/{rel_path}?token={token}"
    return {
        "path": rel_path,
        "url": (backend_url.rstrip("/") + rel_url) if backend_url else rel_url,
        "relative_url": rel_url,
        "size": len(content),
    }


@api_router.get("/files/{full_path:path}")
async def download_image(full_path: str, token: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    # Accept either a Bearer session token for admins/owners OR the per-file public_token (web <img> use case).
    doc = await db.uploads.find_one({"path": full_path}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    authorized = False
    if token and token == doc.get("public_token"):
        authorized = True
    elif authorization and authorization.startswith("Bearer "):
        tok = authorization.split(" ", 1)[1]
        session = await db.user_sessions.find_one({"session_token": tok}, {"_id": 0})
        if session:
            authorized = True
    # Product images are referenced from the catalog so they must be viewable to any customer:
    # if the path is tagged in a product.image we also allow public access.
    if not authorized:
        prod = await db.products.find_one({"image": {"$regex": full_path}})
        if prod:
            authorized = True
    if not authorized:
        raise HTTPException(401, "Not authorized")
    content, ctype = await run_in_threadpool(_get_object, full_path)
    return Response(content=content, media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})# ---------- Admin: All Orders + Status ----------
class OrderStatusUpdateRequest(BaseModel):
    status: str  # pending, paid, shipped, delivered, cancelled


@api_router.get("/admin/orders")
async def admin_list_orders(status: Optional[str] = None, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    q = {}
    if status:
        q["status"] = status
    docs = await db.orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for d in docs:
        _serialize_order(d)
    # Aggregate stats
    pending_count = await db.orders.count_documents({"status": "pending"})
    paid_count = await db.orders.count_documents({"status": "paid"})
    revenue_agg = await db.orders.aggregate([
        {"$match": {"status": {"$in": ["paid", "shipped", "delivered"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}},
    ]).to_list(1)
    revenue = round(revenue_agg[0]["total"], 2) if revenue_agg else 0.0
    return {
        "orders": docs,
        "stats": {"pending": pending_count, "paid": paid_count, "revenue": revenue, "count": len(docs)},
    }


@api_router.get("/admin/orders/{order_id}")
async def admin_get_order(order_id: str, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    d = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")
    _serialize_order(d)
    return {"order": d}


@api_router.put("/admin/orders/{order_id}/status")
async def admin_update_order_status(order_id: str, req: OrderStatusUpdateRequest, authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    valid = {"pending", "paid", "shipped", "delivered", "cancelled"}
    if req.status not in valid:
        raise HTTPException(400, "Invalid status")
    now = datetime.now(timezone.utc)
    upd = {"status": req.status}
    if req.status == "paid":
        upd["paid_at"] = now
    note_map = {
        "pending": "Marked pending",
        "paid": "Payment confirmed",
        "shipped": "Order shipped",
        "delivered": "Order delivered",
        "cancelled": "Order cancelled",
    }
    r = await db.orders.update_one(
        {"id": order_id},
        {
            "$set": upd,
            "$push": {"status_history": {
                "status": req.status, "at": now,
                "note": note_map.get(req.status, req.status),
                "by": admin.get("email", ""),
            }},
        },
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Order not found")
    return {"ok": True}


# ---------- Admin: Product Stock Toggle ----------
class StockToggleRequest(BaseModel):
    in_stock: bool


@api_router.put("/admin/products/{product_id}/stock")
async def admin_toggle_stock(product_id: str, req: StockToggleRequest, authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    r = await db.products.update_one({"id": product_id}, {"$set": {"in_stock": req.in_stock}})
    if r.matched_count == 0:
        raise HTTPException(404, "Product not found")
    return {"ok": True, "in_stock": req.in_stock}


@api_router.get("/")
async def root():
    return {"message": "Herbal Bloom API"}


# ---------- Seed sample products ----------
SAMPLE_PRODUCTS = [
    {
        "id": "p_ashwagandha",
        "name": "Ashwagandha Capsules",
        "tagline": "Stress relief & energy",
        "description": "Premium organic ashwagandha root extract capsules, 60 count. Helps reduce stress, improve sleep, and boost energy naturally.",
        "price": 499.0,
        "image": "https://images.unsplash.com/photo-1734607404574-df50e1839d6d?crop=entropy&cs=srgb&fm=jpg&w=800&q=80",
        "category": "Capsules",
        "benefits": ["Reduces stress & anxiety", "Boosts energy", "Improves sleep quality"],
        "ingredients": ["Ashwagandha Root Extract 600mg", "Vegetable Capsule Shell"],
    },
    {
        "id": "p_tulsi_tea",
        "name": "Tulsi Holy Basil Tea",
        "tagline": "Immunity & calm",
        "description": "Hand-picked organic tulsi leaves, blended for daily immunity support. Caffeine-free, 25 tea bags.",
        "price": 249.0,
        "image": "https://images.unsplash.com/photo-1571934811356-5cc061b6821f?crop=entropy&cs=srgb&fm=jpg&w=800&q=80",
        "category": "Teas",
        "benefits": ["Boosts immunity", "Calms the mind", "Supports respiratory health"],
        "ingredients": ["Rama Tulsi", "Krishna Tulsi", "Vana Tulsi"],
    },
    {
        "id": "p_neem_caps",
        "name": "Neem Pure Capsules",
        "tagline": "Skin & blood purifier",
        "description": "Pure neem leaf extract capsules — nature's purifier for clear skin and overall wellness.",
        "price": 379.0,
        "image": "https://images.unsplash.com/photo-1611073615452-4889ade8d09b?crop=entropy&cs=srgb&fm=jpg&w=800&q=80",
        "category": "Capsules",
        "benefits": ["Purifies blood", "Clears skin", "Supports immunity"],
        "ingredients": ["Neem Leaf Extract 500mg"],
    },
    {
        "id": "p_turmeric",
        "name": "Turmeric Curcumin Plus",
        "tagline": "Anti-inflammatory power",
        "description": "High-potency turmeric with 95% curcuminoids and black pepper for maximum absorption.",
        "price": 599.0,
        "image": "https://images.unsplash.com/photo-1615485500704-8e990f9900f7?crop=entropy&cs=srgb&fm=jpg&w=800&q=80",
        "category": "Capsules",
        "benefits": ["Reduces inflammation", "Joint support", "Antioxidant rich"],
        "ingredients": ["Turmeric Extract 500mg", "Black Pepper Extract 5mg"],
    },
    {
        "id": "p_chamomile",
        "name": "Chamomile Sleep Tea",
        "tagline": "Restful nights",
        "description": "Soothing chamomile flower tea blend for deep, restful sleep. 20 tea bags.",
        "price": 229.0,
        "image": "https://images.unsplash.com/photo-1597481499750-3e6b22637e12?crop=entropy&cs=srgb&fm=jpg&w=800&q=80",
        "category": "Teas",
        "benefits": ["Promotes sleep", "Reduces anxiety", "Aids digestion"],
        "ingredients": ["Egyptian Chamomile Flowers", "Lavender", "Honey Powder"],
    },
    {
        "id": "p_brahmi_oil",
        "name": "Brahmi Hair Oil",
        "tagline": "Stronger, healthier hair",
        "description": "Traditional cold-pressed brahmi oil enriched with bhringraj and amla for hair growth and scalp nourishment.",
        "price": 349.0,
        "image": "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?crop=entropy&cs=srgb&fm=jpg&w=800&q=80",
        "category": "Oils",
        "benefits": ["Promotes hair growth", "Reduces hair fall", "Cools the scalp"],
        "ingredients": ["Brahmi", "Bhringraj", "Amla", "Coconut Oil"],
    },
    {
        "id": "p_giloy",
        "name": "Giloy Immunity Drops",
        "tagline": "Daily immunity shield",
        "description": "Concentrated giloy stem extract — the classic Ayurvedic immunity tonic in liquid form.",
        "price": 299.0,
        "image": "https://images.unsplash.com/photo-1556228720-195a672e8a03?crop=entropy&cs=srgb&fm=jpg&w=800&q=80",
        "category": "Drops",
        "benefits": ["Strengthens immunity", "Detoxifies", "Supports liver"],
        "ingredients": ["Giloy Stem Extract", "Filtered Water"],
    },
    {
        "id": "p_triphala",
        "name": "Triphala Churna",
        "tagline": "Gentle gut cleanse",
        "description": "Traditional blend of Amalaki, Bibhitaki & Haritaki for gentle daily digestion support.",
        "price": 219.0,
        "image": "https://images.unsplash.com/photo-1607197109166-3ab4ee3b3261?crop=entropy&cs=srgb&fm=jpg&w=800&q=80",
        "category": "Powders",
        "benefits": ["Aids digestion", "Detoxifies", "Rich in antioxidants"],
        "ingredients": ["Amalaki", "Bibhitaki", "Haritaki"],
    },
]


@app.on_event("startup")
async def on_startup():
    # indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.products.create_index("id", unique=True)
    await db.orders.create_index("id", unique=True)
    await db.uploads.create_index("path", unique=True)
    # Backfill status_history on legacy orders
    try:
        await db.orders.update_many(
            {"status_history": {"$exists": False}},
            [{"$set": {"status_history": [{
                "status": "$status",
                "at": "$created_at",
                "note": "Order placed",
            }]}}],
        )
    except Exception as e:
        logger.warning(f"status_history backfill failed: {e}")
    # Init object storage
    try:
        _init_storage()
    except Exception as e:
        logger.warning(f"storage init at startup: {e}")
    # seed
    for p in SAMPLE_PRODUCTS:
        await db.products.update_one({"id": p["id"]}, {"$set": p}, upsert=True)
    # seed categories list from distinct if not already set
    existing = await db.settings.find_one({"key": "categories"})
    if not existing:
        cats = sorted(await db.products.distinct("category"))
        await db.settings.update_one(
            {"key": "categories"},
            {"$set": {"key": "categories", "list": cats}},
            upsert=True,
        )
    logger.info("Startup complete. Products seeded.")


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
