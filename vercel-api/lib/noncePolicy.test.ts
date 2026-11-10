import assert from "node:assert/strict";
import test from "node:test";
import { decideNonce } from "./noncePolicy.ts";

test("a stored connection code can be used", () => {
  assert.deepEqual(decideNonce("1"), { ok: true });
  assert.deepEqual(decideNonce(true), { ok: true });
});

test("a missing or already used code is rejected with a recoverable message", () => {
  for (const stored of [null, undefined, "", 0, false]) {
    const decision = decideNonce(stored);
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 401);
      assert.match(decision.error, /start the bank connection again/i);
    }
  }
});
