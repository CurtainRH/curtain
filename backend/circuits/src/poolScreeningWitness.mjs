import { buildPoseidon } from "circomlibjs";

const DEPTH = 16;

function assertField(value, name) {
  const n = BigInt(value);
  if (n < 0n) throw new Error(`${name} must be non-negative`);
  return n;
}

/** Builds inputs for pool_screening.circom and derives its public outputs. */
export async function buildPoolScreeningWitness({
  credentialSecret,
  attestationId,
  scope,
  siblings,
  pathBits,
}) {
  if (!Array.isArray(siblings) || siblings.length !== DEPTH) {
    throw new Error(`siblings must contain ${DEPTH} entries`);
  }
  if (!Array.isArray(pathBits) || pathBits.length !== DEPTH) {
    throw new Error(`pathBits must contain ${DEPTH} entries`);
  }

  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const credential = assertField(credentialSecret, "credentialSecret");
  const attestation = assertField(attestationId, "attestationId");
  const screeningScope = assertField(scope, "scope");
  const bits = pathBits.map((bit, i) => {
    const n = Number(bit);
    if (n !== 0 && n !== 1) throw new Error(`pathBits[${i}] must be 0 or 1`);
    return n;
  });

  let level = poseidon([credential, attestation]);
  for (let i = 0; i < DEPTH; i++) {
    const sibling = assertField(siblings[i], `siblings[${i}]`);
    level = bits[i] === 0 ? poseidon([level, sibling]) : poseidon([sibling, level]);
  }
  const nullifier = poseidon([credential, screeningScope]);
  return {
    credentialSecret: credential.toString(),
    attestationId: attestation.toString(),
    scope: screeningScope.toString(),
    siblings: siblings.map((value, i) => assertField(value, `siblings[${i}]`).toString()),
    pathBits: bits,
    root: F.toObject(level).toString(),
    screeningNullifier: F.toObject(nullifier).toString(),
  };
}

export { DEPTH };
