# AVR Organics — PRD

## Overview
A herbal products e-commerce mobile app for AVR Organics. Customers browse herbal remedies, add to cart, checkout, and rate products after delivery. Admin (store owner) can manage product listings and support contact info from inside the app.

## Tech Stack
- Frontend: Expo (SDK 54) React Native, expo-router, expo-image, expo-linear-gradient
- Backend: FastAPI + Motor (MongoDB)
- Auth: Emergent-managed Google Login (session_token via expo-secure-store)
- Payments: Razorpay (live keys to be added later — checkout currently simulates a successful payment via the `/orders/{id}/mock-pay` route until keys are configured)
- Storage: MongoDB collections — users, user_sessions, products, carts, orders, reviews, settings

## Core Features
1. Google sign-in via Emergent Auth.
2. Product catalog with category filter chips, hero banner, product cards with star ratings.
3. Product detail screen — benefits, ingredients, reviews, Add to Cart.
4. Cart with quantity controls and sticky checkout CTA.
5. Checkout — delivery form + order creation. On success, payment is simulated via `mock-pay` (will switch to Razorpay verify once keys are live).
6. Orders list — paid / pending orders with item thumbnails and "Write a Review" action.
7. Reviews — only buyers of a product (paid order) can review. 1–5 stars + comment.
8. Support screen — opens mailto: and wa.me link from settings.
9. Admin Panel (visible only when `is_admin: true`) — full CRUD for products + editable support email/WhatsApp.

## Admin Rule
The first user to log in becomes admin automatically. Additional admins can be set via `ADMIN_EMAILS` env (comma-separated).

## Razorpay (to add later)
Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `/app/backend/.env` to switch from mock payment to live Razorpay checkout. Backend already creates Razorpay orders and verifies HMAC SHA256 signatures.

## Support Defaults
- Email: support@herbalbloom.app (editable via admin panel)
- WhatsApp: +91 9677337727 (editable via admin panel)
