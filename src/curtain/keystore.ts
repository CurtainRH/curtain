/**
 * #9 fresh wallets: Ethereum keystore V3 files (scrypt + AES-128-CTR), the format MetaMask,
 * Rabby and other wallets import with "Import account -> JSON file". Everything runs in the
 * browser; the raw key never leaves this module unencrypted.
 */
import { scryptAsync } from "@noble/hashes/scrypt";
import { bytesToHex, concat, hexToBytes, keccak256, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export interface KeystoreV3 {
  version: 3;
  id: string;
  address: string; // lowercase, no 0x
  crypto: {
    cipher: "aes-128-ctr";
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: "scrypt";
    kdfparams: { dklen: 32; n: number; r: number; p: number; salt: string };
    mac: string;
  };
}

/** scrypt cost: 2^17 (ethers' default is 2^17; MetaMask imports any valid N). */
export const KEYSTORE_N = 131_072;

const strip = (h: string) => h.replace(/^0x/, "");

async function aesCtr(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // Copies into plain ArrayBuffer-backed arrays, which Web Crypto's types require.
  const k = await crypto.subtle.importKey("raw", Uint8Array.from(key), { name: "AES-CTR" }, false, [
    "encrypt",
  ]);
  return new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CTR", counter: Uint8Array.from(iv), length: 128 },
      k,
      Uint8Array.from(data),
    ),
  );
}

function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = bytesToHex(b).slice(2);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function encryptKeystore(
  privateKey: Hex,
  password: string,
  n = KEYSTORE_N,
): Promise<KeystoreV3> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const dk = await scryptAsync(new TextEncoder().encode(password.normalize("NFKC")), salt, {
    N: n,
    r: 8,
    p: 1,
    dkLen: 32,
  });
  const ciphertext = await aesCtr(dk.slice(0, 16), iv, hexToBytes(privateKey));
  const mac = keccak256(concat([dk.slice(16, 32), ciphertext]));
  return {
    version: 3,
    id: uuid(),
    address: strip(privateKeyToAccount(privateKey).address).toLowerCase(),
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: strip(bytesToHex(iv)) },
      ciphertext: strip(bytesToHex(ciphertext)),
      kdf: "scrypt",
      kdfparams: { dklen: 32, n, r: 8, p: 1, salt: strip(bytesToHex(salt)) },
      mac: strip(mac),
    },
  };
}

/** Decrypts a keystore made by encryptKeystore; throws on a wrong password or a damaged file. */
export async function decryptKeystore(ks: KeystoreV3, password: string): Promise<Hex> {
  // Some wallets (ethers among them) write the section as "Crypto".
  const section = ks.crypto ?? (ks as unknown as { Crypto?: KeystoreV3["crypto"] }).Crypto;
  if (!section || section.kdf !== "scrypt" || section.cipher !== "aes-128-ctr")
    throw new Error("Unsupported wallet file.");
  const { kdfparams: kp, cipherparams, ciphertext, mac } = section;
  const dk = await scryptAsync(
    new TextEncoder().encode(password.normalize("NFKC")),
    hexToBytes(`0x${kp.salt}`),
    {
      N: kp.n,
      r: kp.r,
      p: kp.p,
      dkLen: kp.dklen,
    },
  );
  const ct = hexToBytes(`0x${ciphertext}`);
  if (strip(keccak256(concat([dk.slice(16, 32), ct]))) !== mac.toLowerCase())
    throw new Error("Wrong password.");
  const key = bytesToHex(await aesCtr(dk.slice(0, 16), hexToBytes(`0x${cipherparams.iv}`), ct));
  if (strip(privateKeyToAccount(key).address).toLowerCase() !== ks.address)
    throw new Error("This wallet file is damaged.");
  return key;
}

/**
 * Creates a brand-new wallet and returns only its address and encrypted file. The file is
 * decrypted once before returning, so a file that couldn't be opened again is never handed out.
 */
export async function createFreshWallet(
  password: string,
): Promise<{ address: Address; keystore: KeystoreV3 }> {
  let key: Hex | undefined = generatePrivateKey();
  try {
    const address = privateKeyToAccount(key).address;
    const keystore = await encryptKeystore(key, password);
    if ((await decryptKeystore(keystore, password)) !== key)
      throw new Error("The wallet file failed its check. Nothing was created; try again.");
    return { address, keystore };
  } finally {
    key = undefined;
  }
}
