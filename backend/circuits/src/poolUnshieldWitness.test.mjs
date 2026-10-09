import test from "node:test";
import assert from "node:assert/strict";
import { buildPoolUnshieldWitness, DEPTH } from "./poolUnshieldWitness.mjs";

test("builds an unshield witness with the contract public outputs", async () => {
  const witness = await buildPoolUnshieldWitness({
    secret: 11n,
    tokenId: 22n,
    amount: 33n,
    nullifierNonce: 44n,
    siblings: Array.from({ length: DEPTH }, (_, i) => BigInt(i + 100)),
    pathBits: Array.from({ length: DEPTH }, (_, i) => i % 2),
    recipient: 55n,
  });
  assert.equal(witness.publicTokenId, "22");
  assert.equal(witness.publicAmount, "33");
  assert.equal(witness.publicRecipient, "55");
  assert.notEqual(witness.root, "0");
  assert.notEqual(witness.nullifier, "0");
});
