import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildPoolSpendWitness, DEPTH } from "./poolSpendWitness.mjs";
import * as snarkjs from "snarkjs";

const root = new URL("..", import.meta.url).pathname;
const wasm = `${root}pool_spend_js/pool_spend.wasm`;
const zkey = `${root}pool_spend_dev.zkey`;
const r1cs = `${root}pool_spend.r1cs`;
const proofPath = `${root}.local-proof.json`;
const publicPath = `${root}.local-public.json`;

if (!existsSync(wasm) || !existsSync(r1cs) || !existsSync(zkey)) {
  throw new Error("Compile the spend circuit and create pool_spend_dev.zkey before proving.");
}

const input = await buildPoolSpendWitness({
  secret: 11n,
  tokenId: 22n,
  amount: 33n,
  recipientHash: 55n,
  siblings: Array.from({ length: DEPTH }, (_, i) => BigInt(i + 100)),
  pathBits: Array.from({ length: DEPTH }, (_, i) => i % 2),
});
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
const verificationPath = `${root}pool_spend_dev.vkey.json`;
execFileSync("npx", ["snarkjs", "zkey", "export", "verificationkey", zkey, verificationPath], { stdio: "ignore" });
const verificationKey = JSON.parse(readFileSync(verificationPath, "utf8"));
const verified = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
if (!verified) throw new Error("local Groth16 proof did not verify");
console.log(JSON.stringify({ verified, publicSignals }));
