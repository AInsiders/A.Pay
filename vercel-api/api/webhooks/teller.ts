import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Teller-Signature");
}

/**
 * Teller webhook: verify HMAC per https://teller.io/docs/api/webhooks
 * Set TELLER_WEBHOOK_SIGNING_SECRETS to one or more comma-separated secrets from the dashboard.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawSecrets = process.env.TELLER_WEBHOOK_SIGNING_SECRETS?.trim()
    ? process.env.TELLER_WEBHOOK_SIGNING_SECRETS.split(",").map((s) => s.trim()).filter(Boolean)
    : process.env.TELLER_WEBHOOK_SIGNING_SECRET?.trim()
      ? [process.env.TELLER_WEBHOOK_SIGNING_SECRET.trim()]
      : [];

  if (rawSecrets.length === 0) {
    return res.status(503).json({ error: "Webhook signing secret not configured" });
  }

  const sigHeader = (req.headers["teller-signature"] as string | undefined) ?? "";
  const m = /^t=(\d+),/.exec(sigHeader);
  if (!m) {
    return res.status(400).json({ error: "Missing Teller-Signature" });
  }
  const t = parseInt(m[1], 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > 180) {
    return res.status(400).json({ error: "Stale signature timestamp" });
  }

  const bodyStr = await readRawBody(req);

  const signedMessage = `${t}.${bodyStr}`;

  const v1Sigs = [...sigHeader.matchAll(/v1=([^,]+)/g)].map((x) => x[1].trim());
  if (v1Sigs.length === 0) {
    return res.status(400).json({ error: "No v1 signatures" });
  }

  let matched = false;
  for (const secret of rawSecrets) {
    const expected = createHmac("sha256", secret).update(signedMessage, "utf8").digest("hex");
    for (const v1 of v1Sigs) {
      try {
        const a = Buffer.from(expected, "hex");
        const b = Buffer.from(v1, "hex");
        if (a.length === b.length && timingSafeEqual(a, b)) {
          matched = true;
          break;
        }
      } catch {
        // continue
      }
    }
    if (matched) break;
  }

  if (!matched) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  let payload: { type?: string; payload?: { enrollment_id?: string; reason?: string } };
  try {
    payload = JSON.parse(bodyStr);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  try {
    const { kv } = await import("@vercel/kv");
    if (
      process.env.KV_REST_API_URL &&
      process.env.KV_REST_API_TOKEN &&
      payload.type === "enrollment.disconnected"
    ) {
      const id = payload.payload?.enrollment_id;
      if (id) {
        await kv.set(
          `teller_disconnect:${id}`,
          JSON.stringify({
            reason: payload.payload?.reason ?? "",
            at: new Date().toISOString(),
          }),
          { ex: 60 * 60 * 24 * 30 },
        );
      }
    }
  } catch {
    // KV optional
  }

  return res.status(200).json({ received: true });
}
