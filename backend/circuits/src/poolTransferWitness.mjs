import { buildPoseidon } from "circomlibjs";

const DEPTH = 16;

function assertField(value, name) {
  const n = BigInt(value);
  if (n < 0n) throw new Error(`${name} must be non-negative`);
  return n;
}

/** Builds inputs and public outputs for pool_transfer.circom. */
export async function buildPoolTransferWitness({
  secret,
  tokenId,
  amount,
  siblings,
  pathBits,
  outputSecrets,
  outputAmounts,
}) {
  if (!Array.isArray(siblings) || siblings.length !== DEPTH) throw new Error(`siblings must contain ${DEPTH} entries`);
  if (!Array.isArray(pathBits) || pathBits.length !== DEPTH) throw new Error(`pathBits must contain ${DEPTH} entries`);
  if (!Array.isArray(outputSecrets) || outputSecrets.length !== 2) throw new Error("outputSecrets must contain 2 entries");
  if (!Array.isArray(outputAmounts) || outputAmounts.length !== 2) throw new Error("outputAmounts must contain 2 entries");

  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const s = assertField(secret, "secret");
  const t = assertField(tokenId, "tokenId");
  const a = assertField(amount, "amount");
  const outputs = outputAmounts.map((value, i) => assertField(value, `outputAmounts[${i}]`));
  if (a !== outputs[0] + outputs[1]) throw new Error("amount must equal the two output amounts");
  if (outputs.some((value) => value === 0n)) throw new Error("output amounts must be non-zero");

  const bits = pathBits.map((bit, i) => {
    const n = Number(bit);
    if (n !== 0 && n !== 1) throw new Error(`pathBits[${i}] must be 0 or 1`);
    return n;
  });
  let level = poseidon([s, t, a]);
  for (let i = 0; i < DEPTH; i++) {
    const sibling = assertField(siblings[i], `siblings[${i}]`);
    level = bits[i] === 0 ? poseidon([level, sibling]) : poseidon([sibling, level]);
  }
  const nullifier = poseidon([s, poseidon([s, t, a])]);
  const commitments = outputSecrets.map((value, i) => poseidon([
    assertField(value, `outputSecrets[${i}]`), t, outputs[i],
  ]));
  return {
    secret: s.toString(), tokenId: t.toString(), amount: a.toString(),
    siblings: siblings.map((value, i) => assertField(value, `siblings[${i}]`).toString()),
    pathBits: bits,
    outputSecret: outputSecrets.map((value, i) => assertField(value, `outputSecrets[${i}]`).toString()),
    outputAmount: outputs.map((value) => value.toString()),
    root: F.toObject(level).toString(),
    nullifier: F.toObject(nullifier).toString(),
    publicTokenId: t.toString(),
    outputCommitment: commitments.map((value) => F.toObject(value).toString()),
  };
}

export { DEPTH };
