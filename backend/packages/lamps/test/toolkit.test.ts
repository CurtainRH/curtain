import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { pgliteDb } from "@curtain/db/pglite";
import { eip712ReceiptVerifier } from "../src/receipts";
import { createLampsToolkit, LampsError, type LampsOffer, type LampsStore, type LampsReservation } from "../src";
import { postgresLampsStore } from "../src/postgres";

const host = privateKeyToAccount(`0x${"11".repeat(32)}`);
const offer: LampsOffer = {
  id: "gpu-window", hostId: "host-a", gpuClass: "A10", region: "us-west",
  startsAt: "2030-01-01T12:00:00.000Z", endsAt: "2030-01-01T14:00:00.000Z",
  capacity: 1, priceAsset: "test-token", priceAmount: "1000", tasks: ["inference"],
};
const receipt = {
  boothsRequestId: "job-1", startedAt: offer.startsAt, finishedAt: "2030-01-01T13:00:00.000Z",
  resultHash: `0x${"ab".repeat(32)}` as `0x${string}`, usageSeconds: 3600,
};

async function makeStore(): Promise<{ store: LampsStore; close: () => Promise<void> }> {
  const db = await pgliteDb();
  await db.exec(await Bun.file(new URL("../sql/schema.sql", import.meta.url)).text());
  return { store: postgresLampsStore(db), close: async () => { /* PGlite is process-local in tests. */ } };
}

describe("Lamps toolkit integrations", () => {
  test("persists offers/bookings and reserves capacity atomically/idempotently", async () => {
    const { store } = await makeStore();
    const toolkit = createLampsToolkit({
      store, receipts: { verify: async () => true },
      escrow: fakeEscrow(), stakePolicy: { buyerDisputeStakeBps: 500, hostBondBps: 2000 },
      now: () => Date.parse("2030-01-01T10:00:00.000Z"),
    });
    await toolkit.publish(offer, { provider: "test", devices: ["A10"], tasks: ["inference"] });
    const first = await toolkit.reserve(offer.id, "buyer", "request-1");
    const duplicate = await toolkit.reserve(offer.id, "buyer", "request-1");
    expect(duplicate.id).toBe(first.id);
    await expect(toolkit.reserve(offer.id, "buyer-2", "request-2")).rejects.toMatchObject({ code: "SOLD_OUT" });
    expect((await store.getReservation(first.id))?.status).toBe("reserved");
  });

  test("rejects unsigned receipts and only resolves a dispute through the escrow mutual-consent port", async () => {
    const { store } = await makeStore();
    let clock = Date.parse("2030-01-01T10:00:00.000Z");
    let resolutionCalls = 0;
    const escrow = fakeEscrow({ resolveByMutualAgreement: async () => { resolutionCalls++; } });
    const verifier = eip712ReceiptVerifier({
      chainId: 4663, verifyingContract: "0x0000000000000000000000000000000000000001",
      hostAddress: async () => host.address,
    });
    const toolkit = createLampsToolkit({ store, receipts: verifier, escrow,
      stakePolicy: { buyerDisputeStakeBps: 500, hostBondBps: 2000 }, now: () => clock });
    await toolkit.publish(offer, { provider: "test", devices: ["A10"], tasks: ["inference"] });
    const booking = await toolkit.reserve(offer.id, "buyer", "request-1");
    await toolkit.fund(booking.id, "buyer");
    await toolkit.postHostBond(booking.id, "host-a");
    await toolkit.accept(booking.id, "host-a");
    clock = Date.parse(offer.startsAt);
    await toolkit.start(booking.id, "host-a", receipt.boothsRequestId);
    const typed = {
      domain: { name: "LampsReceipt" as const, version: "1" as const, chainId: 4663,
        verifyingContract: "0x0000000000000000000000000000000000000001" as const },
      types: { UsageReceipt: [
        { name: "reservationId", type: "string" }, { name: "hostId", type: "string" },
        { name: "boothsRequestId", type: "string" }, { name: "startedAt", type: "string" },
        { name: "finishedAt", type: "string" }, { name: "resultHash", type: "bytes32" },
        { name: "usageSeconds", type: "uint64" },
      ] }, primaryType: "UsageReceipt" as const,
      message: { reservationId: booking.id, hostId: "host-a", boothsRequestId: receipt.boothsRequestId,
        startedAt: receipt.startedAt, finishedAt: receipt.finishedAt, resultHash: receipt.resultHash, usageSeconds: 3600n },
    };
    const signature = await host.signTypedData(typed);
    const signed = { reservationId: booking.id, hostId: "host-a", receipt, signature };
    await expect(toolkit.deliverSigned({ ...signed, signature: `0x${"00".repeat(65)}` as `0x${string}` }))
      .rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    await toolkit.deliverSigned(signed);
    expect((await store.getReservation(booking.id))?.receiptSignature).toBe(signature);
    await toolkit.dispute(booking.id, "buyer", "Output failed validation");
    await toolkit.resolveDispute({ reservationId: booking.id, buyerSignature: signature,
      hostSignature: signature, buyerRefundAmount: "1000", buyerStakeRefundAmount: "50", hostBondToBuyerAmount: "200" });
    expect(resolutionCalls).toBe(1);
    expect((await store.getReservation(booking.id))?.paymentStatus).toBe("released");
    expect((await store.getReservation(booking.id))?.disputeResolution?.hostBondToBuyerAmount).toBe("200");
  });

  test("rejects invalid stake policy instead of silently choosing economics", async () => {
    const { store } = await makeStore();
    expect(() => createLampsToolkit({ store, receipts: { verify: async () => true }, escrow: fakeEscrow(),
      stakePolicy: { buyerDisputeStakeBps: 10_001, hostBondBps: 0 } })).toThrow(LampsError);
  });
});

function fakeEscrow(overrides: Partial<Parameters<typeof createLampsToolkit>[0]["escrow"]> = {}) {
  return {
    fundBuyer: async () => {}, postHostBond: async () => {}, release: async () => {}, refundNoShow: async () => {}, openDispute: async () => {},
    resolveByMutualAgreement: async () => {}, ...overrides,
  };
}
