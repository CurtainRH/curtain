import { describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  computeStealthPrivateKey,
  encodeMetaAddress,
  generateStealthAddress,
  isCompressedPublicKey,
  metaAddressFromKeys,
  parseMetaAddress,
  viewTagMatches,
} from "../src/stealth";

describe("stealth addresses (ERC-5564 scheme 1)", () => {
  test("the receiver's derived key controls every generated address", () => {
    for (let i = 0; i < 50; i++) {
      const spend = generatePrivateKey();
      const view = generatePrivateKey();
      const meta = parseMetaAddress(encodeMetaAddress(metaAddressFromKeys(spend, view)));
      const pay = generateStealthAddress(meta);
      expect(viewTagMatches(view, pay.ephemeralPublicKey, pay.viewTag)).toBe(true);
      const key = computeStealthPrivateKey(spend, view, pay.ephemeralPublicKey);
      expect(privateKeyToAccount(key).address).toBe(pay.stealthAddress);
    }
  });

  test("every payment gets a fresh address and ephemeral key", () => {
    const meta = metaAddressFromKeys(generatePrivateKey(), generatePrivateKey());
    const a = generateStealthAddress(meta);
    const b = generateStealthAddress(meta);
    expect(a.stealthAddress).not.toBe(b.stealthAddress);
    expect(a.ephemeralPublicKey).not.toBe(b.ephemeralPublicKey);
    expect(isCompressedPublicKey(a.ephemeralPublicKey)).toBe(true);
    expect(a.viewTag).toMatch(/^0x[0-9a-f]{2}$/);
  });

  test("a different viewing key does not find the payment", () => {
    const meta = metaAddressFromKeys(generatePrivateKey(), generatePrivateKey());
    const pay = generateStealthAddress(meta);
    let matches = 0;
    for (let i = 0; i < 64; i++) if (viewTagMatches(generatePrivateKey(), pay.ephemeralPublicKey, pay.viewTag)) matches++;
    expect(matches).toBeLessThan(4); // a 1-byte tag matches ~1/256 of strangers
  });

  test("deterministic for a fixed ephemeral key", () => {
    const meta = metaAddressFromKeys(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000000000000000000000000000002",
    );
    const eph = "0x0000000000000000000000000000000000000000000000000000000000000003";
    expect(generateStealthAddress(meta, eph)).toEqual(generateStealthAddress(meta, eph));
  });

  test("parses the text form and the raw registry bytes, rejects bad keys", () => {
    const meta = metaAddressFromKeys(generatePrivateKey(), generatePrivateKey());
    const text = encodeMetaAddress(meta);
    expect(text.startsWith("st:eth:0x")).toBe(true);
    expect(parseMetaAddress(text)).toEqual(meta);
    expect(parseMetaAddress(`0x${text.slice(9)}`)).toEqual(meta);
    expect(parseMetaAddress(`  ${text.toUpperCase().replace("ST:ETH:0X", "st:eth:0x")}  `)).toEqual(meta);

    expect(() => parseMetaAddress("0x1234")).toThrow();
    expect(() => parseMetaAddress(privateKeyToAccount(generatePrivateKey()).address)).toThrow();
    // Right length, but the x-coordinate 0 is not on the curve.
    expect(() => parseMetaAddress(`st:eth:0x02${"00".repeat(32)}${meta.viewingPublicKey.slice(2)}`)).toThrow();
    // Wrong prefix byte (04 is uncompressed).
    expect(() => parseMetaAddress(`st:eth:0x04${meta.spendingPublicKey.slice(4)}${meta.viewingPublicKey.slice(2)}`)).toThrow();
  });
});
