export type NonceDecision =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * A stored nonce must still be present when key-value storage is in use.
 * Callers delete it only after the signature checks out, so a mistyped
 * or rejected enrollment can be submitted again with the same code.
 */
export function decideNonce(stored: unknown): NonceDecision {
  if (stored) return { ok: true };
  return {
    ok: false,
    status: 401,
    error: "That connection code expired or was already used. Start the bank connection again.",
  };
}
