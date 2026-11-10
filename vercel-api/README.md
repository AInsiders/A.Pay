# BillPayer Teller API (Vercel)

Deploy this folder as a Vercel project (set **Root Directory** to `vercel-api` if the repo also contains the Android app).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELLER_TOKEN_SIGNING_PUBLIC_KEY` | Yes (for `/api/teller/verify-enrollment`) | 32-byte Ed25519 public key from the Teller Dashboard (Token Signing Key), hex (64 chars) or base64. |
| `TELLER_TOKEN_SIGNING_PUBLIC_KEYS` | Alternative | Comma-separated list for key rotation (same format as above). |
| `TELLER_WEBHOOK_SIGNING_SECRET` | For webhooks | HMAC secret from Application Settings (single). |
| `TELLER_WEBHOOK_SIGNING_SECRETS` | Alternative | Comma-separated secrets during rotation. |
| `KV_REST_API_URL` | Optional | Vercel KV URL for single-use nonces (`/api/teller/nonce`) and disconnect markers from webhooks. |
| `KV_REST_API_TOKEN` | Optional | Vercel KV token. |

## Routes

- `GET /api/teller/nonce` — Returns `{ "nonce": "<hex>" }`. If KV is configured, stores the nonce for 15 minutes. Verify accepts that nonce once, and only deletes it after the signature matches, so a failed check can be retried. A missing or already-used nonce is rejected when KV is on.
- `POST /api/teller/verify-enrollment` — JSON body: `nonce`, `accessToken`, `userId`, `enrollmentId`, `environment`, `signatures` (string array). Verifies an Ed25519 signature from Teller. Does not log the access token.
- `POST /api/webhooks/teller` — Teller webhook URL; verifies `Teller-Signature` and optionally records `enrollment.disconnected` in KV.

## Local testing

```bash
cd vercel-api
npm install
npx vercel dev
```
