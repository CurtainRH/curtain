import { describe, expect, test } from "bun:test";
import { createRigRate, RigRateError, type RigRateObservation } from "../src";

const current = Date.parse("2030-01-08T12:00:00.000Z");
const observation = (id: string, overrides: Partial<RigRateObservation> = {}): RigRateObservation => ({
  id,
  source: "booths",
  sourceReference: `session-${id}`,
  gpuClass: "NVIDIA H100",
  priceAsset: "USDG",
  priceAmount: "10000000",
  durationSeconds: 3600,
  gpuCount: 1,
  observedAt: "2030-01-08T11:30:00.000Z",
  settled: true,
  ...overrides,
});

describe("Rig Rate", () => {
  test("calculates a median hourly rate across Booths, Lamps, and public boards", () => {
    const rigRate = createRigRate({ now: () => current });
    rigRate.record(observation("booths", { priceAmount: "10000000" }));
    rigRate.record(observation("lamps", { source: "lamps", sourceReference: "reservation-1", priceAmount: "48000000", durationSeconds: 7200, gpuCount: 2 }));
    rigRate.record(observation("board", { source: "public-board", sourceReference: "board-quote-1", priceAmount: "11000000", settled: false }));

    expect(rigRate.quote("NVIDIA H100", "USDG")).toMatchObject({
      pricePerGpuHour: "11000000", observations: 3, sources: ["booths", "lamps", "public-board"], flags: ["low-quality"],
    });
  });

  test("normalizes multi-GPU and multi-hour observations and retains history", () => {
    const rigRate = createRigRate({ now: () => current, minObservations: 2 });
    rigRate.record(observation("a", { priceAmount: "24000000", durationSeconds: 7200, gpuCount: 2, observedAt: "2030-01-08T10:00:00.000Z" }));
    rigRate.record(observation("b", { priceAmount: "3000000", durationSeconds: 1800, observedAt: "2030-01-08T11:00:00.000Z" }));
    expect(rigRate.quote("NVIDIA H100", "USDG").pricePerGpuHour).toBe("6000000");
    expect(rigRate.history("NVIDIA H100", "USDG").map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  test("flags a thin, single-source, aging market and excludes expired observations", () => {
    const rigRate = createRigRate({ now: () => current, maxAgeSeconds: 3600, minObservations: 3 });
    rigRate.record(observation("recent", { observedAt: "2030-01-08T11:40:00.000Z" }));
    expect(rigRate.quote("NVIDIA H100", "USDG").flags).toEqual(["thin-market", "single-source"]);
    rigRate.record(observation("old", { id: "old", observedAt: "2030-01-08T10:00:00.000Z" }));
    expect(rigRate.quote("NVIDIA H100", "USDG").observations).toBe(1);
  });

  test("rejects malformed, future, and duplicate observations", () => {
    const rigRate = createRigRate({ now: () => current });
    expect(() => rigRate.record(observation("bad", { priceAmount: "0" }))).toThrow(RigRateError);
    expect(() => rigRate.record(observation("future", { observedAt: "2030-01-08T12:06:00.000Z" }))).toThrow("future");
    rigRate.record(observation("same"));
    expect(() => rigRate.record(observation("same"))).toThrow("already exists");
  });

  test("returns explicit windowed thin-market and insufficient-data results with provenance", () => {
    const rigRate = createRigRate({ now: () => current, minObservations: 3 });
    rigRate.record(observation("west-1", { region: "us-west" }));
    rigRate.record(observation("west-2", { region: "us-west", source: "lamps", sourceReference: "lamp-1", priceAmount: "11000000" }));
    const result = rigRate.evaluate({ gpuClass: "NVIDIA H100", priceAsset: "USDG", region: "us-west", windowStart: "2030-01-08T11:00:00.000Z", windowEnd: "2030-01-08T12:00:00.000Z" });
    expect(result).toMatchObject({ status: "thin_market", observations: 2, provenance: { observationIds: ["west-1", "west-2"] } });
    expect(rigRate.evaluate({ gpuClass: "NVIDIA H100", priceAsset: "USDG", region: "eu-west", windowStart: "2030-01-08T11:00:00.000Z", windowEnd: "2030-01-08T12:00:00.000Z" }).status).toBe("insufficient_data");
  });

  test("ingests Booths/Lamps-shaped adapter records, persists them, and excludes an outlier", async () => {
    const persisted: string[] = [];
    const rigRate = createRigRate({ now: () => current, minObservations: 2, maxOutlierDeviationBps: 2_000, store: { async put(entry) { persisted.push(entry.id); }, async list() { return []; } } });
    await rigRate.ingest({ id: "fixture-adapter", async fetch() { return [
      observation("booths-fixture", { region: "us-east", source: "booths", sourceReference: "booths-session-1", priceAmount: "10000000" }),
      observation("lamps-fixture", { region: "us-east", source: "lamps", sourceReference: "lamps-reservation-1", priceAmount: "11000000" }),
      observation("board-outlier", { region: "us-east", source: "public-board", sourceReference: "board-quote-1", priceAmount: "100000000" }),
    ]; } }, { gpuClass: "NVIDIA H100", priceAsset: "USDG", region: "us-east", windowStart: "2030-01-08T11:00:00.000Z", windowEnd: "2030-01-08T12:00:00.000Z" });
    const result = rigRate.evaluate({ gpuClass: "NVIDIA H100", priceAsset: "USDG", region: "us-east", windowStart: "2030-01-08T11:00:00.000Z", windowEnd: "2030-01-08T12:00:00.000Z" });
    expect(persisted).toEqual(["booths-fixture", "lamps-fixture", "board-outlier"]);
    expect(result).toMatchObject({ status: "ok", pricePerGpuHour: "10500000", observations: 2, provenance: { excludedObservationIds: ["board-outlier"] } });
  });
});
