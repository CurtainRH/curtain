import { buildPoseidon } from "circomlibjs";

const DEPTH = 16;

function assertField(value, name) {
  const n = BigInt(value);
  if (n < 0n) throw new Error(`${name} must be non-negative`);
  return n;
}

/** Builds the inputs expected by pool_spend.circom. */
export async function buildPoolSpendWitness({ secret, tokenId, amount, nullifierNonce, recipientHash, siblings, pathBits }) {
  if (!Array.isArray(siblings) || siblings.length !== DEPTH) throw new Error(`siblings must contain ${DEPTH} entries`);
  if (!Array.isArray(pathBits) || pathBits.length !== DEPTH) throw new Error(`pathBits must contain ${DEPTH} entries`);
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const s = assertField(secret, "secret");
  const t = assertField(tokenId, "tokenId");
  const a = assertField(amount, "amount");
  const nonce = assertField(nullifierNonce, "nullifierNonce");
  const recipient = assertField(recipientHash, "recipientHash");
  const bits = pathBits.map((bit, i) => {
    const n = Number(bit);
    if (n !== 0 && n !== 1) throw new Error(`pathBits[${i}] must be 0 or 1`);
    return n;
  });
  const leaf = poseidon([s, t, a]);
  let level = leaf;
  for (let i = 0; i < DEPTH; i++) {
    const sibling = assertField(siblings[i], `siblings[${i}]`);
    level = bits[i] === 0 ? poseidon([level, sibling]) : poseidon([sibling, level]);
  }
  const nullifier = poseidon([s, nonce]);
  return {
    secret: s.toString(), tokenId: t.toString(), amount: a.toString(), nullifierNonce: nonce.toString(),
    recipientHash: recipient.toString(), siblings: siblings.map((v, i) => assertField(v, `siblings[${i}]`).toString()),
    pathBits: bits, root: F.toObject(level).toString(), nullifier: F.toObject(nullifier).toString(),
  };
}

export { DEPTH };
