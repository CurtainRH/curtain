import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as snarkjs from "snarkjs";
import { buildPoolTransferWitness, DEPTH } from "./poolTransferWitness.mjs";

const root = new URL("..", import.meta.url).pathname;
const wasm = `${root}pool_transfer_js/pool_transfer.wasm`;
const zkey = `${root}pool_transfer_groth16_dev.zkey`;
const vkeyPath = `${root}pool_transfer_groth16_dev.vkey.json`;
const inputPath = `${root}.local-transfer-input.json`;
const witnessPath = `${root}.local-transfer.wtns`;
const proofPath = `${root}.local-transfer-proof.json`;
const publicPath = `${root}.local-transfer-public.json`;
const prover = process.env.RAPIDSNARK_BIN || "rapidsnark";

if (!existsSync(wasm) || !existsSync(zkey)) {
  throw new Error("Compile the transfer circuit and create pool_transfer_groth16_dev.zkey first.");
}

const input = await buildPoolTransferWitness({
  secret: 11n,
  tokenId: 22n,
  amount: 33n,
  nullifierNonce: 44n,
  siblings: Array.from({ length: DEPTH }, (_, i) => BigInt(i + 100)),
  pathBits: Array.from({ length: DEPTH }, (_, i) => i % 2),
  outputSecrets: [55n, 66n],
  outputAmounts: [12n, 21n],
});
const circuitInput = {
  secret: input.secret,
  tokenId: input.tokenId,
  amount: input.amount,
  nullifierNonce: input.nullifierNonce,
  siblings: input.siblings,
  pathBits: input.pathBits,
  outputSecret: input.outputSecret,
  outputAmount: input.outputAmount,
};

writeFileSync(inputPath, JSON.stringify(circuitInput));
execFileSync("npx", ["snarkjs", "wtns", "calculate", wasm, inputPath, witnessPath], { stdio: "inherit" });
execFileSync(prover, [zkey, witnessPath, proofPath, publicPath], { stdio: "inherit" });
execFileSync("npx", ["snarkjs", "zkey", "export", "verificationkey", zkey, vkeyPath], { stdio: "ignore" });

const verificationKey = JSON.parse(readFileSync(vkeyPath, "utf8"));
const proof = JSON.parse(readFileSync(proofPath, "utf8"));
const publicSignals = JSON.parse(readFileSync(publicPath, "utf8"));
const verified = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
if (!verified) throw new Error("Rapidsnark transfer proof did not verify");
console.log(JSON.stringify({ verified, publicSignals, prover }));
