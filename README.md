# Naija Earn API

Node.js + Express + MongoDB (Mongoose) + Cloudinary, with Paystack and Flutterwave. Built for Render.

**Business model (kept deliberately compliant).** Members join free and are paid per validated video view,
out of an advertiser's prepaid campaign budget. Spark / Boost / Prime are *advertiser* packages. Members never pay
to earn, and withdrawals are never gated on referrals.

## Run locally
1. Create a free **MongoDB Atlas** cluster (a replica set is required because money moves inside transactions) and a **Cloudinary** account.
2. `cp .env.example .env` and fill it in. Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
3. `npm install`
4. Create two admins (settings changes need a second admin to approve):
   ```
   npm run seed:admin -- admin1@yourdomain.com 'LongStrongPassword1' "Admin One"
   npm run seed:admin -- admin2@yourdomain.com 'LongStrongPassword2' "Admin Two"
   ```
5. `npm run dev` then open http://localhost:4000/health

## Test with Postman
Import both files in `postman/`. Set `baseUrl`, then run in order: **Register → Verify** (dev codes are filled in
automatically while `EXPOSE_DEV_CODES=true`), **Login ADMIN**, then the Advertise, Admin and Watch folders.
Tokens and ids are saved by the test scripts.

## Deploy on Render
1. Push this folder to its own GitHub repo (e.g. `Naija-api`).
2. Render → **New → Blueprint** → pick the repo (it reads `render.yaml`), or **New → Web Service** with build `npm ci`, start `npm start`, health check `/health`.
3. Fill the secret env vars (everything marked `sync: false`). Set `CLIENT_ORIGINS` to your frontend URL(s), no trailing slash.
4. In MongoDB Atlas → Network Access, allow Render (start with `0.0.0.0/0`, tighten later) and use a dedicated DB user.
5. Webhooks (use your Render URL):
   - Paystack dashboard → Settings → API & Webhooks → `https://YOUR-APP.onrender.com/api/webhooks/paystack`
   - Flutterwave dashboard → Settings → Webhooks → `https://YOUR-APP.onrender.com/api/webhooks/flutterwave`, and put the same "secret hash" in `FLUTTERWAVE_SECRET_HASH`.
6. Free Render instances sleep after inactivity; use a paid instance before real users.

## Endpoints (all under `/api`, JSON, `Authorization: Bearer <token>`)
| Area | Endpoint |
|---|---|
| Public | `GET /public/config` packages, daily cap, minimum withdrawal, bank details |
| Auth | `POST /auth/register` `/login` `/verify` `/resend` `/forgot` `/reset` |
| Member | `GET /me`, `GET /me/dashboard`, `GET /me/referrals` |
| Videos | `GET /videos`, `POST /videos/:id/start`, `POST /videos/sessions/:id/complete` |
| Advertise | `POST /uploads/video-signature`, `GET/POST /orders`, `POST /orders/:id/verify`, `POST /orders/:id/cancel` |
| Withdrawals | `GET/POST /withdrawals` |
| Admin | `/admin/overview` `/users` `/deposits` `/campaigns` `/withdrawals` `/settings` `/audit` |
| Webhooks | `POST /webhooks/paystack`, `POST /webhooks/flutterwave` |

## How the money rules are enforced
- **Rewards come only from a funded campaign.** The campaign budget is decremented atomically in the same transaction that credits the member, so a reward can never be paid from an empty budget.
- **No skipping.** The server stores when a video started and rejects completion before the video's full duration has passed.
- **Daily limit** (default 3, resets at Africa/Lagos midnight) is an atomic counter, safe under concurrent requests. One validated view per member per campaign; one video in progress at a time.
- **Payments are never trusted from the browser.** An order becomes PAID only after the server verifies the transaction with Paystack/Flutterwave (amount and currency checked). Webhooks only say where to look and are signature-checked; the settle step is idempotent.
- **Manual transfers** need a proof upload (stored privately on Cloudinary) and an admin to enter the bank credit reference.
- **Video checks.** The browser uploads video directly to Cloudinary using a server signature; the server reads the real duration (10–120 s) from Cloudinary and an admin approves content before it goes live.
- **Withdrawals** reserve the balance atomically at request time, then move PENDING → APPROVED → PAID, or REJECTED (balance refunded). Minimum, fee and cap come from versioned settings.
- **Settings and package prices** use a two-person rule: one admin proposes, a different admin approves. Member reward per view can never exceed the advertiser rate per view (price ÷ views).
- Security: helmet, strict CORS allow-list, rate limits (tighter on auth), bcrypt, JWT with revocation on password reset or suspension, input validation on every route, no secrets in responses.

## Connecting the React frontend
The current frontend still uses its in-browser demo store. To switch, replace the functions in `src/store.js` with calls to this API
(store the JWT, send it in the `Authorization` header, set `VITE_API_URL`). Gateway checkout: open the `paymentUrl` returned by `POST /orders`,
and when the buyer returns to `PAYMENT_RETURN_URL?order=<id>`, call `POST /orders/:id/verify`.

## Before real money
- Have a Nigerian fintech/securities lawyer review the model and terms; get a business bank account and your own Paystack/Flutterwave live keys.
- Configure real email (SMTP) and SMS (Termii); set `EXPOSE_DEV_CODES=false` (the Render blueprint already does).
- Add automated tests, error monitoring, database backups, and a refund process for rejected advertiser videos (the API flags `refundDue` but does not move money back).
- Add a KYC/bank-name-verification step before large payouts, and review fraud signals (many accounts per device or IP).
