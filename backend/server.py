from fastapi import FastAPI, APIRouter, HTTPException, Header, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import hmac
import hashlib
import httpx
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
    payment_method: str = "razorpay"  # or "cod"


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

    doc = {
        "id": order_id,
        "user_id": user["user_id"],
        "items": items,
        "address": req.address.model_dump(),
        "subtotal": round(subtotal, 2),
        "shipping": shipping,
        "total": total,
        "payment_method": req.payment_method,
        "razorpay_order_id": rzp_order_id,
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
    }
    await db.orders.insert_one(doc)
    return {
        "order_id": order_id,
        "razorpay_order_id": rzp_order_id,
        "razorpay_key_id": RAZORPAY_KEY_ID,
        "amount": int(total * 100),
        "currency": "INR",
        "total": total,
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

    await db.orders.update_one(
        {"id": req.order_id},
        {"$set": {
            "status": "paid",
            "razorpay_payment_id": req.razorpay_payment_id,
            "paid_at": datetime.now(timezone.utc),
        }},
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
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "paid",
            "razorpay_payment_id": f"mock_pay_{uuid.uuid4().hex[:10]}",
            "paid_at": datetime.now(timezone.utc),
        }},
    )
    await db.carts.update_one({"user_id": user["user_id"]}, {"$set": {"items": []}}, upsert=True)
    return {"ok": True, "status": "paid"}


@api_router.get("/orders/me")
async def my_orders(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    docs = await db.orders.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    for d in docs:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        if isinstance(d.get("paid_at"), datetime):
            d["paid_at"] = d["paid_at"].isoformat()
    return {"orders": docs}


@api_router.get("/orders/{order_id}")
async def get_order(order_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    d = await db.orders.find_one({"id": order_id, "user_id": user["user_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")
    if isinstance(d.get("created_at"), datetime):
        d["created_at"] = d["created_at"].isoformat()
    if isinstance(d.get("paid_at"), datetime):
        d["paid_at"] = d["paid_at"].isoformat()
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


@api_router.get("/support/info")
async def support_info():
    s = await get_support_settings()
    wp = s["whatsapp"].replace("+", "").replace(" ", "").replace("-", "")
    return {
        "email": s["email"],
        "whatsapp": s["whatsapp"],
        "whatsapp_link": f"https://wa.me/{wp}",
    }


class SupportUpdateRequest(BaseModel):
    email: str
    whatsapp: str


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
    # seed
    for p in SAMPLE_PRODUCTS:
        await db.products.update_one({"id": p["id"]}, {"$set": p}, upsert=True)
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
