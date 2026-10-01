const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: "Method Not Allowed",
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const {
      client_id,
      checkout_token,
      event_id,
      timestamp,
      fbp,
      fbc,
      fbclid,
      page_url,
      user_agent,
    } = body;

    if (!client_id && !checkout_token) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          reason: "Missing client_id and checkout_token",
        }),
      };
    }

    const store = getStore({
      name: "meta-identifiers",
      region: "ap-southeast-1",
      consistency: "strong",
    });

    const record = {
      client_id: client_id || "",
      checkout_token: checkout_token || "",
      event_id: event_id || "",
      timestamp: timestamp || new Date().toISOString(),

      fbp: fbp || "",
      fbc: fbc || "",
      fbclid: fbclid || "",

      page_url: page_url || "",
      user_agent: user_agent || "",

      saved_at: new Date().toISOString(),
    };

    if (client_id) {
      await store.setJSON(`client/${client_id}`, record);
    }

    if (checkout_token) {
      await store.setJSON(`checkout/${checkout_token}`, record);
    }

    console.log("💾 Meta identifiers saved:", {
      client_id,
      checkout_token,
      has_fbp: Boolean(fbp),
      has_fbc: Boolean(fbc),
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
      }),
    };
  } catch (err) {
    console.error("❌ Identifier save error:", err);

    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: false,
        error: err.message,
      }),
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "https://bulletproofvest.ph",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

