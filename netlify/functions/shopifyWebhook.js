// netlify/functions/shopifyWebhook.js
const crypto = require("crypto");

// ENV VARS (set in Netlify → Environment Variables)
const META_PIXEL_ID = process.env.META_PIXEL_ID;           // e.g. 1562008814991248
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;   // Your Meta CAPI token
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || ""; 
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || ""; // optional (for testing)

function sha256(v) {
  return crypto
    .createHash("sha256")
    .update(String(v || "").trim().toLowerCase())
    .digest("hex");
}

function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  if (!secret) return true;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const h = Buffer.from(hmacHeader || "", "utf8");
  const d = Buffer.from(digest, "utf8");
  return h.length === d.length && crypto.timingSafeEqual(d, h);
}

exports.handler = async (event) => {
  try {
    console.log("✅ Shopify webhook triggered");

    // Verify Shopify HMAC
    const hmacHeader =
      event.headers["x-shopify-hmac-sha256"] ||
      event.headers["X-Shopify-Hmac-Sha256"];

    if (!verifyShopifyHmac(event.body || "", hmacHeader, SHOPIFY_WEBHOOK_SECRET)) {
      console.error("❌ Invalid HMAC");
      return { statusCode: 401, body: "Invalid HMAC" };
    }

    const order = JSON.parse(event.body || "{}");

    // 🔒 DELAYED TAGGING FILTER
    // Only fire Purchase once Shopify marks the order as PAID
    if (order.financial_status !== "paid") {
      console.log("⚠️ Order ignored (not paid yet):", {
        financial_status: order.financial_status,
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ ignored: true, reason: "not paid yet" }),
      };
    }

    console.log("📦 Paid order received:", order.id);

    // ----- USER IDENTIFIERS -----
    const email =
      (order.email ||
        (order.customer && order.customer.email) ||
        "").trim();

    const phoneRaw = (
      order.phone ||
      (order.billing_address && order.billing_address.phone) ||
      (order.customer && order.customer.phone) ||
      ""
    ).replace(/\D/g, "");

    // Persisted FBP / FBC from cart attributes
    const noteAttrs = Object.fromEntries(
      (order.note_attributes || []).map((a) => [a.name, a.value])
    );

    const fbp = noteAttrs._fbp || undefined;
    const fbc = noteAttrs._fbc || undefined;

    // Event ID for deduplication
    const eventId = String(order.checkout_id || order.id);

    // ----- PURCHASE VALUES -----
    const currency = order.currency || "PHP";
    const value = Number(order.total_price || 0);

    const contents = (order.line_items || []).map((li) => ({
      id: li.sku || String(li.variant_id || li.product_id || ""),
      quantity: li.quantity || 1,
      item_price: Number(li.price || 0),
    }));

    const event_time = Math.floor(
      new Date(order.processed_at || order.updated_at || Date.now()).getTime() / 1000
    );

    // ----- META CAPI EVENT -----
    const eventData = {
      event_name: "Purchase",
      event_time,
      action_source: "website",
      event_id: eventId,
      event_source_url: order.landing_site || undefined,
      user_data: {
        em: email ? sha256(email) : undefined,
        ph: phoneRaw ? sha256(phoneRaw) : undefined,
        fbp,
        fbc,
      },
      custom_data: {
        currency,
        value,
        contents,
      },
    };

    const payload = {
      data: [eventData],
      access_token: META_ACCESS_TOKEN,
      ...(META_TEST_EVENT_CODE ? { test_event_code: META_TEST_EVENT_CODE } : {}),
    };

    console.log("🚀 Sending Purchase to Meta");

    const fbResponse = await fetch(
      `https://graph.facebook.com/v17.0/${META_PIXEL_ID}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const fbJson = await fbResponse.json();
    console.log("✅ Meta response:", fbJson);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, fb: fbJson }),
    };
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return { statusCode: 500, body: err.toString() };
  }
};

