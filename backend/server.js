const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const Razorpay = require("razorpay");

const app = express();
const frontendDirectory = path.join(__dirname, "..", "frontend");
const databasePath = path.resolve(__dirname, process.env.DATABASE_PATH || "data/orders.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new sqlite3.Database(databasePath);
const products = [
  { name: "Classic Gud Blocks", category: "gud", prices: { "500g": 250, "1kg": 450 } },
  { name: "Pure Shakar Powder", category: "shakar", prices: { "500g": 180, "1kg": 330 } },
  { name: "Artisanal Desi Khand", category: "khand", prices: { "500g": 220, "1kg": 400 } },
  { name: "Herbal Nut Jaggery", category: "gud", prices: { "250g": 300, "500g": 560 } },
  { name: "Artisanal Gud (Jaggery)", category: "gud", prices: { "": 250 } },
  { name: "Pure Shakar", category: "shakar", prices: { "": 180 } },
  { name: "Desi Khand", category: "khand", prices: { "": 220 } },
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

app.post("/api/orders/create", async function (request, response) {
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
        razorpay_order_id, amount_paise, currency, status, items,
        delivery_address, billing_address
      ) VALUES (?, ?, ?, 'created', ?, ?, ?)`,
      [
        providerOrder.id,
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
    console.error("Could not initialize the checkout database:", error.message);
    process.exitCode = 1;
    db.close();
    return;
  }
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, function () {
    console.log("UP Mithas is available at http://localhost:" + port);
  });
});
