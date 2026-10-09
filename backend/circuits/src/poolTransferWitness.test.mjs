import test from "node:test";
import assert from "node:assert/strict";
import { buildPoolTransferWitness, DEPTH } from "./poolTransferWitness.mjs";

test("builds a conserving one-to-two private transfer witness", async () => {
  const witness = await buildPoolTransferWitness({
    secret: 11n,
    tokenId: 22n,
    amount: 33n,
    siblings: Array.from({ length: DEPTH }, (_, i) => BigInt(i + 100)),
    pathBits: Array.from({ length: DEPTH }, (_, i) => i % 2),
    outputSecrets: [55n, 66n],
    outputAmounts: [12n, 21n],
  });

  assert.equal(witness.publicTokenId, "22");
  assert.equal(witness.outputCommitment.length, 2);
  assert.match(witness.root, /^[0-9]+$/);
});

test("rejects amount-conservation violations", async () => {
  await assert.rejects(
    buildPoolTransferWitness({
      secret: 1n,
      tokenId: 2n,
      amount: 10n,
      siblings: Array.from({ length: DEPTH }, () => 0n),
      pathBits: Array.from({ length: DEPTH }, () => 0),
      outputSecrets: [4n, 5n],
      outputAmounts: [4n, 5n],
    }),
    /amount must equal the two output amounts/,
  );
});
