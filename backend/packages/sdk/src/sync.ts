/**
 * Ticket sync (FEATURE_TICKET_SYNC): escape tickets backed up on the operator, encrypted in the
 * browser with keys derived from a wallet signature.
 *
 * - id      keccak256("curtain:ticket-sync:id:v1"   || r || s): where the backup is stored
 * - authKey keccak256("curtain:ticket-sync:auth:v1" || r || s): proves the right to overwrite it
 * - encKey  keccak256("curtain:ticket-sync:enc:v1"  || r || s): AES-256-GCM key, never sent
 *
 * Only r and s are used, not v, which some wallets encode as 0/1 and others as 27/28, so the
 * same key gives the same backup on any device. The operator sees an id that isn't the wallet
 * address and a blob it can't open; signing again restores everything.
 */
import { concat, hexToBytes, keccak256, toBytes, toHex, type Hex } from "viem";

export const TICKET_SYNC_MESSAGE = [
  "Curtain ticket backup",
  "",
  "Sign to back up or restore your escape tickets for Curtain on Robinhood Chain.",
  "",
  "This signature unlocks your encrypted backup. Only sign it on the Curtain app, and never share it.",
  "",
  "Version: 1",
].join("\n");

export interface SyncKeys {
  id: Hex;
  authKey: Hex;
  encKey: Uint8Array;
}

export function syncKeysFromSignature(signature: Hex): SyncKeys {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("Unexpected signature format.");
  const rs = hexToBytes(signature).slice(0, 64);
  const derive = (label: string) => keccak256(concat([toBytes(label), rs]));
  return {
    id: derive("curtain:ticket-sync:id:v1"),
    authKey: derive("curtain:ticket-sync:auth:v1"),
    encKey: hexToBytes(derive("curtain:ticket-sync:enc:v1")),
  };
}

async function aesKey(encKey: Uint8Array) {
  return crypto.subtle.importKey("raw", Uint8Array.from(encKey), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** 0x || 12-byte IV || AES-256-GCM ciphertext of the JSON value. */
export async function sealBackup(value: unknown, encKey: Uint8Array): Promise<Hex> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(encKey), plain));
  return toHex(concat([iv, ct]));
}

/** Opens a sealed backup; throws if the key is wrong or the blob was altered. */
export async function openBackup(blob: Hex, encKey: Uint8Array): Promise<unknown> {
  const bytes = hexToBytes(blob);
  if (bytes.length < 28) throw new Error("This backup is damaged.");
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(bytes.slice(0, 12)) },
      await aesKey(encKey),
      Uint8Array.from(bytes.slice(12)),
    );
  } catch {
    throw new Error("This backup can't be opened with these keys.");
  }
  return JSON.parse(new TextDecoder().decode(plain));
}
