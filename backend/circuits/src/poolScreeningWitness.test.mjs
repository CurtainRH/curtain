import test from "node:test";
import assert from "node:assert/strict";
import { buildPoolScreeningWitness, DEPTH } from "./poolScreeningWitness.mjs";

test("builds a deterministic screening membership witness", async () => {
  const witness = await buildPoolScreeningWitness({
    credentialSecret: 11n,
    attestationId: 22n,
    scope: 33n,
    siblings: Array.from({ length: DEPTH }, (_, i) => BigInt(i + 100)),
    pathBits: Array.from({ length: DEPTH }, (_, i) => i % 2),
  });

  assert.equal(witness.siblings.length, DEPTH);
  assert.equal(witness.pathBits.length, DEPTH);
  assert.match(witness.root, /^[0-9]+$/);
  assert.match(witness.screeningNullifier, /^[0-9]+$/);
});

test("rejects malformed screening Merkle paths", async () => {
  await assert.rejects(
    buildPoolScreeningWitness({
      credentialSecret: 1n,
      attestationId: 2n,
      scope: 3n,
      siblings: Array.from({ length: DEPTH }, () => 0n),
      pathBits: Array.from({ length: DEPTH - 1 }, () => 0),
    }),
    /siblings must contain 16 entries|pathBits must contain 16 entries/,
  );
});
