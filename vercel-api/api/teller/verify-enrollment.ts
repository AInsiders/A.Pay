import { createHash } from "node:crypto";
import * as ed25519 from "@noble/ed25519";
import type { VercelRequest, VercelResponse } from "@vercel/node";

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function decodePublicKey(raw: string): Uint8Array {
  const t = raw.trim();
  if (/^[0-9a-fA-F]+$/.test(t) && t.length === 64) {
    return Uint8Array.from(Buffer.from(t, "hex"));
  }
  return Uint8Array.from(Buffer.from(t, "base64"));
}

function decodeSignature(s: string): Uint8Array {
  const t = s.trim();
  return Uint8Array.from(Buffer.from(t, "base64"));
}

function parsePublicKeys(): Uint8Array[] {
  const multi = process.env.TELLER_TOKEN_SIGNING_PUBLIC_KEYS;
  const single = process.env.TELLER_TOKEN_SIGNING_PUBLIC_KEY;
  const raw = multi?.trim()
    ? multi.split(",").map((x) => x.trim()).filter(Boolean)
    : single?.trim()
      ? [single.trim()]
      : [];
  return raw.map(decodePublicKey).filter((k) => k.length === 32);
}

type Body = {
  nonce?: string;
  accessToken?: string;
  userId?: string;
  enrollmentId?: string;
  environment?: string;
  signatures?: string[];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const publicKeys = parsePublicKeys();
  if (publicKeys.length === 0) {
    return res.status(503).json({ error: "TELLER_TOKEN_SIGNING_PUBLIC_KEY not configured" });
  }

  let body: Body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const nonce = body.nonce?.trim();
  const accessToken = body.accessToken?.trim();
  const userId = body.userId?.trim();
  const enrollmentId = body.enrollmentId?.trim();
  const environment = body.environment?.trim();
  const signatures = body.signatures ?? [];

  if (!nonce || !accessToken || !userId || !enrollmentId || !environment) {
    return res.status(400).json({
      error: "Missing nonce, accessToken, userId, enrollmentId, or environment",
    });
  }

  if (!Array.isArray(signatures) || signatures.length === 0) {
    return res.status(400).json({ error: "No signatures to verify" });
  }

  try {
    const { kv } = await import("@vercel/kv");
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const key = `teller_nonce:${nonce}`;
      const ok = await kv.get(key);
      if (ok) {
        await kv.del(key);
      }
    }
  } catch {
    // optional KV
  }

  const dotted =
    `${nonce}.${accessToken}.${userId}.${enrollmentId}.${environment}`;
  const msgUtf8 = new TextEncoder().encode(dotted);
  const msgSha256 = createHash("sha256").update(dotted, "utf8").digest();

  let verified = false;
  for (const sigStr of signatures) {
    let sigBytes: Uint8Array;
    try {
      sigBytes = decodeSignature(sigStr);
    } catch {
      continue;
    }
    for (const pub of publicKeys) {
      try {
        if (
          ed25519.verify(sigBytes, msgUtf8, pub) ||
          ed25519.verify(sigBytes, msgSha256, pub)
        ) {
          verified = true;
          break;
        }
      } catch {
        // try next
      }
    }
    if (verified) break;
  }

  if (!verified) {
    return res.status(401).json({ error: "Signature verification failed" });
  }

  return res.status(200).json({ ok: true });
}
