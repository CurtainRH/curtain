import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as snarkjs from "snarkjs";
import { buildPoolTransferWitness, DEPTH } from "./poolTransferWitness.mjs";

const root = new URL("..", import.meta.url).pathname;
const wasm = `${root}pool_transfer_js/pool_transfer.wasm`;
const zkey = `${root}pool_transfer_v2.zkey`;
const vkeyPath = `${root}pool_transfer_v2.vkey.json`;

if (!existsSync(wasm) || !existsSync(zkey)) {
  throw new Error("Compile the transfer circuit and create pool_transfer_groth16_dev.zkey first.");
}

const input = await buildPoolTransferWitness({
  secret: 11n,
  tokenId: 22n,
  amount: 33n,
  siblings: Array.from({ length: DEPTH }, (_, i) => BigInt(i + 100)),
  pathBits: Array.from({ length: DEPTH }, (_, i) => i % 2),
  outputSecrets: [55n, 66n],
  outputAmounts: [12n, 21n],
});

// Derived outputs are returned by the witness builder for contract binding, but
// must not be passed back as circuit inputs to the witness calculator.
const circuitInput = {
  secret: input.secret,
  tokenId: input.tokenId,
  amount: input.amount,
  siblings: input.siblings,
  pathBits: input.pathBits,
  outputSecret: input.outputSecret,
  outputAmount: input.outputAmount,
};

execFileSync("npx", ["snarkjs", "zkey", "export", "verificationkey", zkey, vkeyPath], { stdio: "ignore" });
const verificationKey = JSON.parse(readFileSync(vkeyPath, "utf8"));
const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInput, wasm, zkey);
const verified = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
if (!verified) throw new Error("local Groth16 transfer proof did not verify");
console.log(JSON.stringify({ verified, publicSignals }));
process.exit(0);
