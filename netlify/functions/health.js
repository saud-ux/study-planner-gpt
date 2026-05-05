export async function handler() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, openaiConfigured: Boolean(process.env.OPENAI_API_KEY) })
  };
}
