import { describe, expect, test } from "bun:test";
import { createLampsBook, LampsError, type LampsOffer } from "../src";

const startAt = "2030-01-01T12:00:00.000Z";
const endAt = "2030-01-01T14:00:00.000Z";
const hostCapabilities = { provider: "test-cuda", devices: ["NVIDIA A10"], tasks: ["inference"] };
const baseOffer = (id = "offer-1"): LampsOffer => ({
  id, hostId: "host-1", gpuClass: "NVIDIA A10", region: "us-west",
  startsAt: startAt, endsAt: endAt, capacity: 1,
  priceAsset: "USDG", priceAmount: "25000000", tasks: ["inference"],
});

describe("cloneable Lamps reserved-window booking", () => {
  test("offers must match the host Booths provider", () => {
    const book = createLampsBook({ now: () => Date.parse("2030-01-01T10:00:00.000Z") });
    expect(() => book.publish(baseOffer(), { ...hostCapabilities, devices: ["CPU"] }))
      .toThrow("does not advertise this GPU class");
    expect(() => book.publish({ ...baseOffer(), capacity: 2 }, hostCapabilities))
      .toThrow("capacity exceeds");
    expect(() => book.publish({ ...baseOffer(), tasks: ["fine-tune"] }, hostCapabilities))
      .toThrow("does not support every offered task");
  });

  test("reserves a fixed window idempotently and enforces capacity", () => {
    const book = createLampsBook({ now: () => Date.parse("2030-01-01T10:00:00.000Z") });
    book.publish(baseOffer(), hostCapabilities);
    const first = book.reserve("offer-1", "buyer-1", "checkout-1");
    expect(first.status).toBe("reserved");
    expect(book.reserve("offer-1", "buyer-1", "checkout-1")).toEqual(first);
    expect(book.availability("offer-1")).toBe(0);
    expect(() => book.reserve("offer-1", "buyer-2", "checkout-2"))
      .toThrow("No capacity remains");
  });

  test("host accepts, starts a Booths job in-window, delivers receipt, buyer confirms", () => {
    let clock = Date.parse("2030-01-01T10:00:00.000Z");
    const book = createLampsBook({ now: () => clock });
    book.publish(baseOffer(), hostCapabilities);
    const reservation = book.reserve("offer-1", "buyer-1", "request-1");
    expect(() => book.accept(reservation.id, "buyer-1")).toThrow("not authorized");
    book.accept(reservation.id, "host-1");
    clock = Date.parse(startAt);
    book.start(reservation.id, "host-1", "booths-job-1");
    clock += 60 * 60 * 1000;
    const delivered = book.deliver(reservation.id, "host-1", {
      boothsRequestId: "booths-job-1", startedAt: startAt,
      finishedAt: "2030-01-01T13:00:00.000Z", resultHash: `0x${"ab".repeat(32)}`, usageSeconds: 3600,
    });
    expect(delivered.status).toBe("delivered");
    expect(book.confirm(reservation.id, "buyer-1").status).toBe("completed");
  });

  test("rejects mismatched receipts and permits a no-show refund only after the window", () => {
    let clock = Date.parse("2030-01-01T10:00:00.000Z");
    const book = createLampsBook({ now: () => clock });
    book.publish({ ...baseOffer(), capacity: 2 }, { ...hostCapabilities, devices: ["NVIDIA A10", "NVIDIA A10"] });
    const reservation = book.reserve("offer-1", "buyer-1", "request-2");
    const noShow = book.reserve("offer-1", "buyer-2", "request-3");
    expect(() => book.refundNoShow(noShow.id, "buyer-2")).toThrow("only after the window");
    book.accept(reservation.id, "host-1");
    clock = Date.parse(startAt);
    book.start(reservation.id, "host-1", "booths-job-2");
    expect(() => book.deliver(reservation.id, "host-1", {
      boothsRequestId: "wrong-job", startedAt: startAt,
      finishedAt: "2030-01-01T13:00:00.000Z", resultHash: `0x${"cd".repeat(32)}`, usageSeconds: 100,
    })).toThrow("does not match");

    clock = Date.parse(endAt);
    expect(() => book.refundNoShow(reservation.id, "buyer-1")).toThrow("never started");
    expect(() => book.refundNoShow(noShow.id, "buyer-2")).not.toThrow();
    expect(book.getReservation(noShow.id)?.status).toBe("refunded");
  });

  test("requires a whole-hour future UTC window and positive price", () => {
    const book = createLampsBook({ now: () => Date.parse("2030-01-01T10:00:00.000Z") });
    expect(() => book.publish({ ...baseOffer(), endsAt: "2030-01-01T13:30:00.000Z" }, hostCapabilities))
      .toThrow(LampsError);
    expect(() => book.publish({ ...baseOffer(), priceAmount: "0" }, hostCapabilities))
      .toThrow("positive uint256");
  });
});
