import { buildPoseidon } from "circomlibjs";

export const DEPTH = 16;

function field(poseidon, value) {
  return poseidon.F.toObject(poseidon([BigInt(value)]));
}

function hash2(poseidon, left, right) {
  return poseidon.F.toObject(poseidon([BigInt(left), BigInt(right)]));
}

export async function buildPoolUnshieldWitness({
  secret,
  tokenId,
  amount,
  nullifierNonce,
  siblings,
  pathBits,
  recipient,
}) {
  if (siblings.length !== DEPTH || pathBits.length !== DEPTH) throw new Error("invalid Merkle path length");
  const poseidon = await buildPoseidon();
  const leaf = poseidon.F.toObject(poseidon([BigInt(secret), BigInt(tokenId), BigInt(amount)]));
  let level = leaf;
  for (let i = 0; i < DEPTH; i++) {
    if (pathBits[i] !== 0 && pathBits[i] !== 1) throw new Error("pathBits must be binary");
    level = pathBits[i] === 0 ? hash2(poseidon, level, siblings[i]) : hash2(poseidon, siblings[i], level);
  }
  const nullifier = poseidon.F.toObject(poseidon([BigInt(secret), BigInt(nullifierNonce)]));
  return {
    secret: BigInt(secret).toString(),
    tokenId: BigInt(tokenId).toString(),
    amount: BigInt(amount).toString(),
    nullifierNonce: BigInt(nullifierNonce).toString(),
    siblings: siblings.map((v) => BigInt(v).toString()),
    pathBits: pathBits.map((v) => Number(v)),
    recipient: BigInt(recipient).toString(),
    root: level.toString(),
    nullifier: nullifier.toString(),
    publicTokenId: BigInt(tokenId).toString(),
    publicAmount: BigInt(amount).toString(),
    publicRecipient: BigInt(recipient).toString(),
  };
}
