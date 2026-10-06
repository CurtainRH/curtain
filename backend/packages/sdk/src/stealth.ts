/**
 * ERC-5564 stealth addresses, scheme 1 (secp256k1 with view tags), and ERC-6538 meta-addresses.
 *
 * A receiver publishes a stealth meta-address: their spending and viewing public keys. A sender
 * derives a fresh one-time address from it that only the receiver can find (with the viewing
 * key) and spend from (with both keys). Nothing on-chain links that address to the receiver.
 *
 *   sender:   ephemeral key p, P = p·G
 *             s   = p·P_view            (ECDH shared secret)
 *             s_h = keccak256(s)        (compressed point, 33 bytes; as the ScopeLift reference SDK)
 *             view tag = s_h[0]
 *             P_stealth = P_spend + s_h·G
 *   receiver: s = p_view·P, same s_h,   p_stealth = p_spend + s_h  (mod n)
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, getAddress, hexToBytes, keccak256, type Address, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";

/** ERC-5564 scheme id for secp256k1 with view tags. */
export const STEALTH_SCHEME_ID = 1n;

export interface StealthMetaAddress {
  spendingPublicKey: Hex; // 33-byte compressed
  viewingPublicKey: Hex; // 33-byte compressed
}

export interface StealthPayment {
  stealthAddress: Address;
  ephemeralPublicKey: Hex; // 33-byte compressed, announced on-chain
  viewTag: Hex; // 1 byte, announced as the first byte of metadata
}

export class StealthError extends Error {}

const N = secp256k1.CURVE.n;

/** A compressed public key that is a valid curve point (not the point at infinity). */
export function isCompressedPublicKey(hex: string): hex is Hex {
  if (!/^0x0[23][0-9a-fA-F]{64}$/.test(hex)) return false;
  try {
    secp256k1.ProjectivePoint.fromHex(hex.slice(2)).assertValidity();
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses `st:<chain>:0x<spend><view>` (EIP-5564 text form) or the raw 66-byte registry value.
 * Rejects anything that isn't two valid compressed secp256k1 points, so a typo can never
 * produce an address nobody controls.
 */
export function parseMetaAddress(input: string): StealthMetaAddress {
  const raw = input.trim();
  const m = raw.match(/^(?:st:[a-z0-9]{1,16}:)?(0x[0-9a-fA-F]{132})$/i);
  if (!m) throw new StealthError("Not a stealth meta-address. It should look like st:eth:0x… (66 bytes).");
  const body = m[1]!.slice(2);
  const spendingPublicKey = `0x${body.slice(0, 66)}`.toLowerCase();
  const viewingPublicKey = `0x${body.slice(66)}`.toLowerCase();
  if (!isCompressedPublicKey(spendingPublicKey) || !isCompressedPublicKey(viewingPublicKey)) {
    throw new StealthError("This stealth meta-address contains an invalid key. Ask the receiver to copy it again.");
  }
  return { spendingPublicKey, viewingPublicKey };
}

export function encodeMetaAddress(meta: StealthMetaAddress, chain = "eth"): string {
  return `st:${chain}:0x${meta.spendingPublicKey.slice(2)}${meta.viewingPublicKey.slice(2)}`;
}

/** keccak256 of the compressed shared secret, reduced to a valid scalar. */
function hashedSecret(shared: Uint8Array): { hash: Hex; scalar: bigint } {
  const hash = keccak256(shared);
  const scalar = BigInt(hash) % N;
  if (scalar === 0n) throw new StealthError("Degenerate shared secret; try again.");
  return { hash, scalar };
}

/** Derives a fresh one-time address for the receiver. `ephemeralPrivateKey` is for tests only. */
export function generateStealthAddress(meta: StealthMetaAddress, ephemeralPrivateKey?: Hex): StealthPayment {
  const eph = ephemeralPrivateKey ? hexToBytes(ephemeralPrivateKey) : secp256k1.utils.randomPrivateKey();
  const shared = secp256k1.getSharedSecret(eph, meta.viewingPublicKey.slice(2), true);
  const { hash, scalar } = hashedSecret(shared);
  const stealthPoint = secp256k1.ProjectivePoint.fromHex(meta.spendingPublicKey.slice(2)).add(
    secp256k1.ProjectivePoint.BASE.multiply(scalar),
  );
  return {
    stealthAddress: getAddress(publicKeyToAddress(bytesToHex(stealthPoint.toRawBytes(false)))),
    ephemeralPublicKey: bytesToHex(secp256k1.getPublicKey(eph, true)),
    viewTag: hash.slice(0, 4) as Hex,
  };
}

/** Receiver side: the view tag check (cheap filter) for one announcement. */
export function viewTagMatches(viewingPrivateKey: Hex, ephemeralPublicKey: Hex, viewTag: Hex): boolean {
  const shared = secp256k1.getSharedSecret(hexToBytes(viewingPrivateKey), ephemeralPublicKey.slice(2), true);
  return hashedSecret(shared).hash.slice(0, 4).toLowerCase() === viewTag.toLowerCase();
}

/** Receiver side: the private key that controls a stealth address. */
export function computeStealthPrivateKey(spendingPrivateKey: Hex, viewingPrivateKey: Hex, ephemeralPublicKey: Hex): Hex {
  const shared = secp256k1.getSharedSecret(hexToBytes(viewingPrivateKey), ephemeralPublicKey.slice(2), true);
  const key = (BigInt(spendingPrivateKey) + hashedSecret(shared).scalar) % N;
  if (key === 0n) throw new StealthError("Degenerate stealth key.");
  return `0x${key.toString(16).padStart(64, "0")}`;
}

/** Meta-address for a pair of private keys (receiver setup, tests). */
export function metaAddressFromKeys(spendingPrivateKey: Hex, viewingPrivateKey: Hex): StealthMetaAddress {
  return {
    spendingPublicKey: bytesToHex(secp256k1.getPublicKey(hexToBytes(spendingPrivateKey), true)),
    viewingPublicKey: bytesToHex(secp256k1.getPublicKey(hexToBytes(viewingPrivateKey), true)),
  };
}

// ---------------------------------------------------------------- receiver side

export const STEALTH_REGISTRY_ABI = [
  { type: "function", name: "stealthMetaAddressOf", stateMutability: "view", inputs: [{ name: "registrant", type: "address" }, { name: "schemeId", type: "uint256" }], outputs: [{ type: "bytes" }] },
  { type: "function", name: "registerKeys", stateMutability: "nonpayable", inputs: [{ name: "schemeId", type: "uint256" }, { name: "stealthMetaAddress", type: "bytes" }], outputs: [] },
] as const;

export const STEALTH_ANNOUNCEMENT_EVENT = {
  type: "event",
  name: "Announcement",
  inputs: [
    { name: "schemeId", type: "uint256", indexed: true },
    { name: "stealthAddress", type: "address", indexed: true },
    { name: "caller", type: "address", indexed: true },
    { name: "ephemeralPubKey", type: "bytes", indexed: false },
    { name: "metadata", type: "bytes", indexed: false },
  ],
} as const;

/**
 * The message a receiver signs to create (or later restore) their stealth keys. It must never
 * change: the keys are derived from the signature, so a new wording would mean new keys.
 */
export const STEALTH_KEYS_MESSAGE = [
  "Curtain stealth keys",
  "",
  "Sign to create or restore your private receiving keys for Curtain on Robinhood Chain.",
  "",
  "This signature unlocks payments sent to your stealth address. Only sign it on the Curtain app, and never share it.",
  "",
  "Version: 1",
].join("\n");

export interface StealthKeys {
  spendingPrivateKey: Hex;
  viewingPrivateKey: Hex;
  meta: StealthMetaAddress;
}

/**
 * Stealth keys from a wallet signature of STEALTH_KEYS_MESSAGE: spending = keccak256(r),
 * viewing = keccak256(s), as the ScopeLift reference SDK. Re-signing restores the same keys,
 * so nothing has to be stored; callers must check the wallet signs deterministically.
 */
export function stealthKeysFromSignature(signature: Hex): StealthKeys {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new StealthError("Unexpected signature format.");
  const spendingPrivateKey = keccak256(`0x${signature.slice(2, 66)}`);
  const viewingPrivateKey = keccak256(`0x${signature.slice(66, 130)}`);
  for (const k of [spendingPrivateKey, viewingPrivateKey]) {
    const n = BigInt(k);
    if (n === 0n || n >= N) throw new StealthError("This signature can't be used as a key. Try another wallet.");
  }
  return { spendingPrivateKey, viewingPrivateKey, meta: metaAddressFromKeys(spendingPrivateKey, viewingPrivateKey) };
}

/** The registry value: 0x + 33-byte spending key + 33-byte viewing key. */
export function metaAddressBytes(meta: StealthMetaAddress): Hex {
  return `0x${meta.spendingPublicKey.slice(2)}${meta.viewingPublicKey.slice(2)}`;
}

/**
 * If an announcement is a payment to these keys, returns the stealth address's private key.
 * Malformed or foreign announcements return null (anyone can announce anything).
 */
export function matchAnnouncement(
  keys: Pick<StealthKeys, "spendingPrivateKey" | "viewingPrivateKey">,
  a: { stealthAddress: string; ephemeralPubKey: string; metadata: string },
): Hex | null {
  try {
    if (!isCompressedPublicKey(a.ephemeralPubKey.toLowerCase()) || !/^0x[0-9a-fA-F]{2}/.test(a.metadata)) return null;
    const eph = a.ephemeralPubKey.toLowerCase() as Hex;
    if (!viewTagMatches(keys.viewingPrivateKey, eph, a.metadata.slice(0, 4) as Hex)) return null;
    const key = computeStealthPrivateKey(keys.spendingPrivateKey, keys.viewingPrivateKey, eph);
    const point = secp256k1.getPublicKey(hexToBytes(key), false);
    return getAddress(publicKeyToAddress(bytesToHex(point))) === getAddress(a.stealthAddress) ? key : null;
  } catch {
    return null;
  }
}
