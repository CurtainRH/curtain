import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as snarkjs from "snarkjs";
import { buildPoolTransferWitness, DEPTH } from "./poolTransferWitness.mjs";

const root = new URL("..", import.meta.url).pathname;
const wasm = `${root}pool_transfer_js/pool_transfer.wasm`;
const zkey = `${root}pool_transfer_plonk_dev.zkey`;
const vkeyPath = `${root}pool_transfer_plonk_dev.vkey.json`;

if (!existsSync(wasm) || !existsSync(zkey)) {
  throw new Error("Compile the transfer circuit and create pool_transfer_plonk_dev.zkey first.");
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

execFileSync("npx", ["snarkjs", "zkey", "export", "verificationkey", zkey, vkeyPath], { stdio: "ignore" });
const verificationKey = JSON.parse(readFileSync(vkeyPath, "utf8"));
// The witness calculator accepts only circuit inputs. The witness builder also
// returns the derived public outputs for callers that need to bind them on-chain,
// so keep those derived values out of the input object passed to snarkjs.
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
const { proof, publicSignals } = await snarkjs.plonk.fullProve(circuitInput, wasm, zkey);
const verified = await snarkjs.plonk.verify(verificationKey, publicSignals, proof);
if (!verified) throw new Error("local Plonk transfer proof did not verify");
console.log(JSON.stringify({ verified, publicSignals }));
