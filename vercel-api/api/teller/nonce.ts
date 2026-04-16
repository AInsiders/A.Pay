import { randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const nonce = randomBytes(32).toString("hex");

  try {
    const { kv } = await import("@vercel/kv");
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      await kv.set(`teller_nonce:${nonce}`, "1", { ex: 900 });
    }
  } catch {
    // KV optional: nonce still works with signature verification on verify-enrollment
  }

  return res.status(200).json({ nonce });
}
