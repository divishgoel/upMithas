const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const Razorpay = require("razorpay");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const frontendDirectory = path.join(__dirname, "..", "frontend");
const databasePath = path.resolve(__dirname, process.env.DATABASE_PATH || "data/orders.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new sqlite3.Database(databasePath);
const googleOAuthClient = new OAuth2Client();
const sessionCookieName = "upmithas_session";
const sessionDurationSeconds = 30 * 24 * 60 * 60;
const products = [
  { name: "Classic Gud Blocks", category: "gud", prices: { "1kg": 160, "": 160 } },
  { name: "Pure Shakar Powder", category: "shakar", prices: { "1kg": 160, "": 160 } },
  { name: "Desi Khand", category: "khand", prices: { "1kg": 160, "": 160 } },
];
const productPrices = new Map();
products.forEach(function (product) {
  Object.keys(product.prices).forEach(function (size) {
    productPrices.set(product.name + "\u0000" + size, product.prices[size]);
  });
});

class RequestError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function run(sql, params) {
  return new Promise(function (resolve, reject) {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params) {
  return new Promise(function (resolve, reject) {
    db.get(sql, params, function (error, row) {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(sql, params) {
  return new Promise(function (resolve, reject) {
    db.all(sql, params, function (error, rows) {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function passwordHash(password, salt) {
  return new Promise(function (resolve, reject) {
    crypto.scrypt(password, salt, 64, function (error, derivedKey) {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function normalizeEmail(email) {
  if (typeof email !== "string") throw new RequestError("Please provide a valid email address.");
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new RequestError("Please provide a valid email address.");
  }
  return normalized;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    address: user.address || "",
    city: user.city || "",
    state: user.state || "",
    postalCode: user.postal_code || "",
  };
}

function parseCookies(header) {
  const cookies = {};
  (header || "").split(";").forEach(function (part) {
    const separator = part.indexOf("=");
    if (separator < 0) return;
    const name = part.slice(0, separator).trim();
    if (name) cookies[name] = part.slice(separator + 1).trim();
  });
  return cookies;
}

async function createSession(response, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + sessionDurationSeconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  await run("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [
    tokenHash,
    userId,
    expiresAt,
  ]);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    sessionCookieName + "=" + token + "; Max-Age=" + sessionDurationSeconds + "; Path=/; HttpOnly; SameSite=Lax" + secure
  );
}

async function authenticate(request, response, next) {
  try {
    const token = parseCookies(request.headers.cookie)[sessionCookieName];
    if (token && /^[A-Za-z0-9_-]{40,50}$/.test(token)) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      request.user = await get(
        `SELECT users.* FROM auth_sessions
         JOIN users ON users.id = auth_sessions.user_id
         WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > CURRENT_TIMESTAMP`,
        [tokenHash]
      );
    }
    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(request, response) {
  if (!request.user) {
    response.status(401).json({ error: "Please sign in to continue." });
    return false;
  }
  return true;
}

function requireText(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new RequestError("Please provide a valid " + label + ".");
  }
  return value.trim();
}

function validateAddress(address) {
  if (!address || typeof address !== "object" || Array.isArray(address)) {
    throw new RequestError("Please provide complete billing and delivery details.");
  }

  const normalized = {
    name: requireText(address.name, "name", 100),
    email: requireText(address.email, "email", 254).toLowerCase(),
    phone: requireText(address.phone, "phone number", 20),
    address: requireText(address.address, "street address", 250),
    city: requireText(address.city, "city", 100),
    state: requireText(address.state, "state", 100),
    postalCode: requireText(address.postalCode, "PIN code", 6),
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    throw new RequestError("Please provide a valid email address.");
  }
  const phoneDigits = normalized.phone.replace(/\D/g, "");
  if (!/^\+?[0-9 ()-]{10,16}$/.test(normalized.phone) || phoneDigits.length < 10 || phoneDigits.length > 15) {
    throw new RequestError("Please provide a valid phone number.");
  }
  if (!/^[0-9]{6}$/.test(normalized.postalCode)) {
    throw new RequestError("Please provide a valid 6-digit PIN code.");
  }
  return normalized;
}

function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new RequestError("Your cart is empty or invalid.");
  }

  const normalizedItems = items.map(function (item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RequestError("Your cart contains an invalid product.");
    }
    const name = requireText(item.name, "product", 100);
    const size = typeof item.size === "string" ? item.size : "";
    const qty = Number(item.qty);
    const unitPrice = productPrices.get(name + "\u0000" + size);
    if (unitPrice === undefined || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new RequestError("Your cart contains an unavailable product or quantity.");
    }
    return { name: name, size: size, qty: qty, unitPrice: unitPrice };
  });

  const amountPaise = normalizedItems.reduce(function (total, item) {
    return total + item.unitPrice * item.qty * 100;
  }, 0);
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new RequestError("The order total is invalid.");
  }
  return { items: normalizedItems, amountPaise: amountPaise };
}

function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return {
    keyId: keyId,
    keySecret: keySecret,
    client: new Razorpay({ key_id: keyId, key_secret: keySecret }),
  };
}

function validPaymentSignature(keySecret, orderId, paymentId, signature) {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(orderId + "|" + paymentId)
    .digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

app.use(express.json({ limit: "16kb" }));

app.get("/api/auth/config", function (_request, response) {
  response.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || "" });
});

app.get("/api/auth/me", authenticate, function (request, response) {
  response.json({ user: request.user ? publicUser(request.user) : null });
});

app.post("/api/auth/signup", async function (request, response) {
  try {
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new RequestError("Please provide your name, email, and password.");
    }
    const name = requireText(body.name, "name", 100);
    const email = normalizeEmail(body.email);
    if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 128) {
      throw new RequestError("Password must be between 10 and 128 characters.");
    }
    const existing = await get("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) return response.status(409).json({ error: "An account with this email already exists." });

    const salt = crypto.randomBytes(16);
    const hash = await passwordHash(body.password, salt);
    const result = await run(
      "INSERT INTO users (name, email, password_salt, password_hash) VALUES (?, ?, ?, ?)",
      [name, email, salt.toString("hex"), hash.toString("hex")]
    );
    const user = await get("SELECT * FROM users WHERE id = ?", [result.lastID]);
    await createSession(response, user.id);
    response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error instanceof RequestError) return response.status(error.status).json({ error: error.message });
    console.error("Could not create customer account:", error.message);
    response.status(500).json({ error: "Could not create your account. Please try again." });
  }
});

app.post("/api/auth/login", async function (request, response) {
  try {
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new RequestError("Please enter your email and password.");
    }
    const email = normalizeEmail(body.email);
    if (typeof body.password !== "string" || body.password.length > 128) {
      throw new RequestError("Email or password is incorrect.");
    }
    const user = await get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user || !user.password_salt || !user.password_hash) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }
    const hash = await passwordHash(body.password, Buffer.from(user.password_salt, "hex"));
    const expectedHash = Buffer.from(user.password_hash, "hex");
    if (hash.length !== expectedHash.length || !crypto.timingSafeEqual(hash, expectedHash)) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }
    await createSession(response, user.id);
    response.json({ user: publicUser(user) });
  } catch (error) {
    if (error instanceof RequestError) return response.status(error.status).json({ error: error.message });
    console.error("Could not sign in customer:", error.message);
    response.status(500).json({ error: "Could not sign in. Please try again." });
  }
});

app.post("/api/auth/google", async function (request, response) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const credential = request.body && request.body.credential;
    if (!clientId) return response.status(503).json({ error: "Google sign-in is not configured yet." });
    if (typeof credential !== "string" || credential.length > 10000) {
      throw new RequestError("Google sign-in could not be completed.");
    }

    let ticket;
    try {
      ticket = await googleOAuthClient.verifyIdToken({ idToken: credential, audience: clientId });
    } catch (_verificationError) {
      return response.status(401).json({ error: "Google sign-in could not be verified. Please try again." });
    }
    const claims = ticket.getPayload();
    if (!claims || typeof claims.sub !== "string" || claims.email_verified !== true) {
      return response.status(401).json({ error: "Google could not verify this email address." });
    }
    const email = normalizeEmail(claims.email);
    const name = typeof claims.name === "string" && claims.name.trim()
      ? claims.name.trim().slice(0, 100)
      : email.slice(0, 100);
    let user = await get("SELECT * FROM users WHERE google_sub = ?", [claims.sub]);
    if (!user) {
      user = await get("SELECT * FROM users WHERE email = ?", [email]);
      if (user && user.google_sub && user.google_sub !== claims.sub) {
        return response.status(409).json({ error: "This email is already linked to another Google account." });
      }
      if (user) {
        await run("UPDATE users SET google_sub = ? WHERE id = ?", [claims.sub, user.id]);
        user = await get("SELECT * FROM users WHERE id = ?", [user.id]);
      } else {
        const result = await run(
          "INSERT INTO users (name, email, google_sub) VALUES (?, ?, ?)",
          [name, email, claims.sub]
        );
        user = await get("SELECT * FROM users WHERE id = ?", [result.lastID]);
      }
    }
    await createSession(response, user.id);
    response.json({ user: publicUser(user) });
  } catch (error) {
    if (error instanceof RequestError) return response.status(error.status).json({ error: error.message });
    console.error("Could not sign in with Google:", error.message);
    response.status(500).json({ error: "Could not sign in with Google. Please try again." });
  }
});

app.post("/api/auth/logout", async function (request, response) {
  try {
    const token = parseCookies(request.headers.cookie)[sessionCookieName];
    if (token && /^[A-Za-z0-9_-]{40,50}$/.test(token)) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await run("DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
    }
    response.setHeader(
      "Set-Cookie",
      sessionCookieName + "=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax" +
        (process.env.NODE_ENV === "production" ? "; Secure" : "")
    );
    response.json({ success: true });
  } catch (error) {
    console.error("Could not sign out customer:", error.message);
    response.status(500).json({ error: "Could not sign out. Please try again." });
  }
});

app.put("/api/auth/profile", authenticate, async function (request, response) {
  try {
    if (!requireAuth(request, response)) return;
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new RequestError("Please provide valid profile details.");
    }
    const name = requireText(body.name, "name", 100);
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const city = typeof body.city === "string" ? body.city.trim() : "";
    const state = typeof body.state === "string" ? body.state.trim() : "";
    const postalCode = typeof body.postalCode === "string" ? body.postalCode.trim() : "";
    if (phone && !/^\+?[0-9 ()-]{10,16}$/.test(phone)) {
      throw new RequestError("Please provide a valid phone number.");
    }
    if (address.length > 250 || city.length > 100 || state.length > 100) {
      throw new RequestError("One or more profile fields are too long.");
    }
    if (postalCode && !/^[0-9]{6}$/.test(postalCode)) {
      throw new RequestError("Please provide a valid 6-digit PIN code.");
    }
    await run(
      `UPDATE users SET name = ?, phone = ?, address = ?, city = ?, state = ?, postal_code = ?
       WHERE id = ?`,
      [name, phone, address, city, state, postalCode, request.user.id]
    );
    const user = await get("SELECT * FROM users WHERE id = ?", [request.user.id]);
    response.json({ user: publicUser(user) });
  } catch (error) {
    if (error instanceof RequestError) return response.status(error.status).json({ error: error.message });
    console.error("Could not update customer profile:", error.message);
    response.status(500).json({ error: "Could not save your profile. Please try again." });
  }
});

app.get("/api/account/orders", authenticate, async function (request, response) {
  try {
    if (!requireAuth(request, response)) return;
    const rows = await all(
      `SELECT razorpay_order_id, amount_paise, currency, status, items, created_at, paid_at
       FROM checkout_orders WHERE user_id = ? ORDER BY id DESC`,
      [request.user.id]
    );
    response.json({
      orders: rows.map(function (order) {
        return {
          orderId: order.razorpay_order_id,
          amount: order.amount_paise,
          currency: order.currency,
          status: order.status,
          items: JSON.parse(order.items),
          createdAt: order.created_at,
          paidAt: order.paid_at,
        };
      }),
    });
  } catch (error) {
    console.error("Could not load customer orders:", error.message);
    response.status(500).json({ error: "Could not load your orders. Please try again." });
  }
});

app.get("/api/products", function (_request, response) {
  response.json({
    products: products.map(function (product) {
      return {
        name: product.name,
        category: product.category,
        variants: Object.keys(product.prices).map(function (size) {
          return { size: size, price: product.prices[size] };
        }),
      };
    }),
  });
});

app.get("/api/postal-codes/:postalCode", async function (request, response) {
  const postalCode = request.params.postalCode;
  if (!/^[0-9]{6}$/.test(postalCode)) {
    return response.status(400).json({ error: "Please provide a valid 6-digit PIN code." });
  }

  try {
    const upstreamResponse = await fetch(
      "https://api.postalpincode.in/pincode/" + postalCode,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!upstreamResponse.ok) {
      throw new Error("Postal lookup service returned HTTP " + upstreamResponse.status + ".");
    }
    const results = await upstreamResponse.json();
    const postOffices = results[0] && results[0].Status === "Success" && results[0].PostOffice;
    if (!Array.isArray(postOffices) || postOffices.length === 0) {
      return response.status(404).json({ error: "No matching postal areas were found." });
    }

    const stateAliases = {
      "Andaman & Nicobar Islands": "Andaman and Nicobar Islands",
      "Dadra & Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",
      "Daman & Diu": "Dadra and Nagar Haveli and Daman and Diu",
      "Jammu & Kashmir": "Jammu and Kashmir",
      "Orissa": "Odisha",
      "Pondicherry": "Puducherry",
      "Uttaranchal": "Uttarakhand",
    };
    const locationsByKey = new Map();
    postOffices.forEach(function (office) {
      const city = office.Block || office.District || office.Name;
      const state = stateAliases[office.State] || office.State;
      if (typeof city !== "string" || typeof state !== "string" || !city.trim() || !state.trim()) return;
      locationsByKey.set(city + "\u0000" + state, { city: city, state: state });
    });
    const locations = Array.from(locationsByKey.values());
    if (locations.length === 0) {
      return response.status(404).json({ error: "No matching postal areas were found." });
    }
    response.json({ locations: locations });
  } catch (error) {
    console.error("Could not look up PIN code:", error.message);
    response.status(502).json({ error: "PIN code lookup is temporarily unavailable." });
  }
});

app.post("/api/wholesale", async function (request, response) {
  try {
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new RequestError("Invalid inquiry details.");
    }
    const name = requireText(body.name, "name", 100);
    const company = requireText(body.company, "company", 150);
    const email = requireText(body.email, "email", 254).toLowerCase();
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const requirement = requireText(body.requirement, "monthly requirement", 50);
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new RequestError("Please provide a valid email address.");
    }
    if (phone && !/^[+]?[0-9 ()-]{10,16}$/.test(phone)) {
      throw new RequestError("Please provide a valid phone number.");
    }
    if (!["50-100", "101-500", "501-1000", "1000+"].includes(requirement)) {
      throw new RequestError("Please select a valid monthly requirement.");
    }

    const result = await run(
      `INSERT INTO wholesale_leads (name, company, email, phone, requirement, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, company, email, phone, requirement, message]
    );
    response.status(201).json({ success: true, leadId: result.lastID });
  } catch (error) {
    if (error instanceof RequestError) {
      return response.status(error.status).json({ error: error.message });
    }
    console.error("Could not save wholesale inquiry:", error.message);
    response.status(500).json({ error: "Could not submit inquiry. Please try again." });
  }
});

app.post("/api/orders/create", authenticate, async function (request, response) {
  try {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      throw new RequestError("Invalid checkout details.");
    }

    const cart = priceCart(request.body.items);
    const deliveryAddress = validateAddress(request.body.deliveryAddress);
    const billingAddress = validateAddress(request.body.billingAddress);
    const gateway = getRazorpay();
    if (!gateway) {
      return response.status(503).json({ error: "Online payment is not configured yet." });
    }
    const providerOrder = await gateway.client.orders.create({
      amount: cart.amountPaise,
      currency: "INR",
      receipt: "upm_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex"),
    });

    await run(
      `INSERT INTO checkout_orders (
        razorpay_order_id, user_id, amount_paise, currency, status, items,
        delivery_address, billing_address
      ) VALUES (?, ?, ?, ?, 'created', ?, ?, ?)`,
      [
        providerOrder.id,
        request.user ? request.user.id : null,
        cart.amountPaise,
        "INR",
        JSON.stringify(cart.items),
        JSON.stringify(deliveryAddress),
        JSON.stringify(billingAddress),
      ]
    );

    response.status(201).json({
      keyId: gateway.keyId,
      orderId: providerOrder.id,
      amount: cart.amountPaise,
      currency: "INR",
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return response.status(error.status).json({ error: error.message });
    }
    console.error("Could not create checkout order:", error.message);
    response.status(502).json({ error: "Could not start payment. Please try again." });
  }
});

app.post("/api/orders/verify", async function (request, response) {
  try {
    const gateway = getRazorpay();
    if (!gateway) {
      return response.status(503).json({ error: "Online payment is not configured yet." });
    }
    const body = request.body;
    const orderId = body && body.orderId;
    const paymentId = body && body.paymentId;
    const signature = body && body.signature;
    if (typeof orderId !== "string" || typeof paymentId !== "string" || !paymentId) {
      throw new RequestError("Payment verification details are incomplete.");
    }
    if (!validPaymentSignature(gateway.keySecret, orderId, paymentId, signature)) {
      return response.status(400).json({ error: "Payment verification failed." });
    }

    const order = await get(
      "SELECT status, payment_id FROM checkout_orders WHERE razorpay_order_id = ?",
      [orderId]
    );
    if (!order) return response.status(404).json({ error: "Order not found." });
    if (order.status === "paid" && order.payment_id === paymentId) {
      return response.json({ success: true });
    }
    if (order.status !== "created") {
      return response.status(409).json({ error: "This order cannot be marked as paid." });
    }

    const result = await run(
      `UPDATE checkout_orders
       SET status = 'paid', payment_id = ?, paid_at = CURRENT_TIMESTAMP
       WHERE razorpay_order_id = ? AND status = 'created'`,
      [paymentId, orderId]
    );
    if (result.changes !== 1) {
      return response.status(409).json({ error: "This order could not be verified." });
    }
    response.json({ success: true });
  } catch (error) {
    if (error instanceof RequestError) {
      return response.status(error.status).json({ error: error.message });
    }
    console.error("Could not verify checkout payment:", error.message);
    response.status(500).json({ error: "Could not verify payment. Please contact support." });
  }
});

app.use(express.static(frontendDirectory));

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_salt TEXT,
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    postal_code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS wholesale_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    requirement TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS checkout_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    razorpay_order_id TEXT NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id),
    amount_paise INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('created', 'paid')),
    items TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    billing_address TEXT NOT NULL,
    payment_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT
  );
`;

db.exec(schema, function (error) {
  if (error) {
    console.error("Could not initialize the application database:", error.message);
    process.exitCode = 1;
    db.close();
    return;
  }

  db.all("PRAGMA table_info(checkout_orders)", function (columnError, columns) {
    if (columnError) {
      console.error("Could not inspect the checkout database:", columnError.message);
      process.exitCode = 1;
      db.close();
      return;
    }

    const hasUserId = columns.some(function (column) {
      return column.name === "user_id";
    });
    const migration = hasUserId
      ? function (callback) { callback(null); }
      : function (callback) {
          db.run("ALTER TABLE checkout_orders ADD COLUMN user_id INTEGER REFERENCES users(id)", callback);
        };
    migration(function (migrationError) {
      if (migrationError) {
        console.error("Could not add customer account support to the checkout database:", migrationError.message);
        process.exitCode = 1;
        db.close();
        return;
      }

      db.run("CREATE INDEX IF NOT EXISTS checkout_orders_user_id ON checkout_orders(user_id)", function (indexError) {
        if (indexError) {
          console.error("Could not index customer orders:", indexError.message);
          process.exitCode = 1;
          db.close();
          return;
        }
        db.run("DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP");
        const port = Number(process.env.PORT) || 3000;
        app.listen(port, function () {
          console.log("UP Mithas is available at http://localhost:" + port);
        });
      });
    });
  });
});
