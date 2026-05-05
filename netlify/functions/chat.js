// Netlify Function: proxies chat requests to Google Gemini.
// The GEMINI_API_KEY is a server-side env var — never exposed to the browser.

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export const handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "missing_server_key" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "bad_json" }) };
  }

  const { systemPrompt = "", history = [], userMessage = "" } = payload;
  if (!userMessage.trim()) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "empty_message" }) };
  }

  const contents = [
    ...history.map((m) => ({
      role: m.role === "bot" ? "model" : "user",
      parts: [{ text: m.text }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
        }),
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: cors,
        body: JSON.stringify({ error: "upstream", status: res.status, detail: data }),
      };
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: "safety_or_empty" }) };
    }

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "network", message: String(e) }) };
  }
};
