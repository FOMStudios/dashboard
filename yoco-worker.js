/* =====================================================================
   FOM STUDIOS — Yoco payment link generator (Cloudflare Worker)
   ---------------------------------------------------------------------
   This tiny server creates a secure Yoco checkout for a given amount and
   returns its payment URL. Your Yoco SECRET key lives here as an encrypted
   Worker secret — it is NEVER in your website or the PDF.

   SET UP (see SETUP_Yoco.md):
     1. Change ALLOWED_ORIGIN below to your site.
     2. Deploy this as a Cloudflare Worker.
     3. Add a secret named  YOCO_SECRET_KEY  =  your sk_live_... key.
     4. Copy the Worker URL into index.html (the PAY.workerUrl setting).
   ===================================================================== */

const ALLOWED_ORIGINS = [
  "https://www.fomstudios.co.za",
  "https://fomstudios.co.za",
  "https://fomstudios.github.io",
];                                                                   // every origin the site is currently reachable from
const SUCCESS_URL    = "https://www.fomstudios.co.za/paid.html";   // thank-you page after paying
const CANCEL_URL     = "https://www.fomstudios.co.za";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405, cors);

    try {
      const body = await request.json();
      const amountCents = Math.round(Number(body.amount) * 100);   // Rands -> cents
      if (!amountCents || amountCents < 200)                        // Yoco minimum is R2
        return json({ error: "Amount must be at least R2." }, 400, cors);

      const payload = {
        amount: amountCents,
        currency: "ZAR",
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
        failureUrl: CANCEL_URL,
        metadata: {
          invoice: String(body.invoice || ""),
          client: String(body.client || ""),
          kind: String(body.kind || ""),   // "deposit" or "full"
        },
      };

      const res = await fetch("https://payments.yoco.com/api/checkouts", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.YOCO_SECRET_KEY,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok)
        return json({ error: (data && data.message) || "Yoco error", detail: data }, res.status, cors);

      return json({ redirectUrl: data.redirectUrl, id: data.id }, 200, cors);
    } catch (e) {
      return json({ error: String(e) }, 500, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
