# UP Mithas

The static storefront lives in `frontend/`. The Express API, Razorpay integration,
and SQLite checkout-order database live in `backend/`.

## Run locally

1. Install the backend dependencies: `cd backend` then `npm install`.
2. Copy `.env.example` to `.env` and set your Razorpay test key ID and secret.
3. Start the site and API with `npm start`.
4. Open `http://localhost:3000`.

The checkout validates product prices on the server and stores pending and paid
orders, including delivery and billing addresses, in `backend/data/orders.db`.
The order total currently reflects product prices only; shipping fees are not
configured. Use Razorpay test credentials while validating the integration and
deploy over HTTPS before accepting live payments. Do not commit `.env` or the
database.
