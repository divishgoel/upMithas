# UP Mithas

The static storefront lives in `frontend/`. The Express API, Razorpay integration,
and SQLite checkout-order database live in `backend/`.

## Run locally

1. Install the backend dependencies: `cd backend` then `npm install`.
2. Copy `backend/.env.example` to `backend/.env`. Set your Razorpay test key ID
   and secret to enable checkout. To enable Google sign-in, set
   `GOOGLE_CLIENT_ID` to a Google OAuth web-client ID and add
   `http://localhost:3000` as an authorized JavaScript origin in Google Cloud.
   Email and password sign-in works without Google credentials.
3. Start the site and API from `backend/` with `npm start`.
4. Open `http://localhost:3000`.

The checkout validates product prices on the server and stores pending and paid
orders, including delivery and billing addresses, in `backend/data/orders.db`.
Customer accounts, hashed passwords, profile details, and account sessions are
stored in the same SQLite database. Passwords are never stored in plain text.
Signed-in checkout orders are linked to the account; guest checkout remains
available. Orders created before account support are not automatically linked
to customer accounts.
Entering a six-digit Indian PIN code looks up its city/district and state / UT;
the results remain editable, and the state / UT can also be selected manually.
The backend retrieves city/district suggestions from `api.postalpincode.in`.
The order total currently reflects product prices only; shipping fees are not
configured. Use Razorpay test credentials while validating the integration and
deploy over HTTPS before accepting live payments. Do not commit `.env` or the
database.
