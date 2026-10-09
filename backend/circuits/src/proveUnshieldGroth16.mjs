import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as snarkjs from "snarkjs";
import { buildPoolUnshieldWitness, DEPTH } from "./poolUnshieldWitness.mjs";

const root = new URL("..", import.meta.url).pathname;
const wasm = `${root}pool_unshield_js/pool_unshield.wasm`;
const zkey = `${root}pool_unshield_v2.zkey`;
const vkeyPath = `${root}pool_unshield_v2.vkey.json`;

if (!existsSync(wasm) || !existsSync(zkey)) throw new Error("Build the production unshield proving key first.");

const input = await buildPoolUnshieldWitness({
  secret: 11n,
  tokenId: 22n,
  amount: 33n,
  siblings: Array.from({ length: DEPTH }, (_, i) => BigInt(i + 100)),
  pathBits: Array.from({ length: DEPTH }, (_, i) => i % 2),
  recipient: 55n,
});

const circuitInput = {
  secret: input.secret,
  tokenId: input.tokenId,
  amount: input.amount,
  siblings: input.siblings,
  pathBits: input.pathBits,
  recipient: input.recipient,
};

execFileSync("npx", ["snarkjs", "zkey", "export", "verificationkey", zkey, vkeyPath], { stdio: "ignore" });
const verificationKey = JSON.parse(readFileSync(vkeyPath, "utf8"));
const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInput, wasm, zkey);
const verified = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
if (!verified) throw new Error("production unshield proof did not verify");
console.log(JSON.stringify({ verified, publicSignals }));
process.exit(0);
