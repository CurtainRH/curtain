import assert from "node:assert/strict";
import test from "node:test";
import { buildPoolSpendWitness, DEPTH } from "./poolSpendWitness.mjs";

test("builds a deterministic Pool v2 spend witness", async () => {
  const input = {
    secret: 11n, tokenId: 22n, amount: 33n, recipientHash: 55n,
    siblings: Array.from({ length: DEPTH }, (_, i) => BigInt(i + 100)),
    pathBits: Array.from({ length: DEPTH }, (_, i) => i % 2),
  };
  const a = await buildPoolSpendWitness(input);
  const b = await buildPoolSpendWitness(input);
  assert.equal(a.root, b.root);
  assert.equal(a.nullifier, b.nullifier);
  assert.match(a.root, /^\d+$/);
  assert.match(a.nullifier, /^\d+$/);
});

test("rejects malformed Merkle paths", async () => {
  await assert.rejects(
    buildPoolSpendWitness({ secret: 1, tokenId: 2, amount: 3, recipientHash: 5, siblings: [], pathBits: [] }),
    /siblings must contain 16 entries/,
  );
});
