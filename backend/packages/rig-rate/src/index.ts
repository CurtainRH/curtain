export type RigRateSource = "booths" | "lamps" | "public-board";
export type RigRateFlag = "thin-market" | "single-source" | "stale" | "low-quality";

/** A price paid or quoted for GPU capacity. Amounts use the smallest unit of `priceAsset`. */
export interface RigRateObservation {
  /** Idempotency key supplied by the data source. */
  id: string;
  source: RigRateSource;
  /** The provider, booking, or board entry that produced this observation. */
  sourceReference: string;
  gpuClass: string;
  priceAsset: string;
  priceAmount: string;
  /** Duration covered by priceAmount. */
  durationSeconds: number;
  /** Number of equivalent GPUs covered by the observation. */
  gpuCount: number;
  /** Canonical UTC timestamp at which the rate was observed or settled. */
  observedAt: string;
  /** False for indicative board prices; true only when the caller has verified settlement. */
  settled: boolean;
}

export interface RigRateOptions {
  now?: () => number;
  /** Ignore observations older than this period. Defaults to seven days. */
  maxAgeSeconds?: number;
  /** A rate below this number of observations is marked thin-market. Defaults to three. */
  minObservations?: number;
}

export interface RigRate {
  gpuClass: string;
  priceAsset: string;
  /** Median hourly price in the smallest unit of priceAsset, rounded half up. */
  pricePerGpuHour: string;
  observedAt: string;
  observations: number;
  sources: RigRateSource[];
  flags: RigRateFlag[];
}

export class RigRateError extends Error {
  constructor(message: string, public readonly code: "INVALID_OBSERVATION" | "DUPLICATE_OBSERVATION" | "NOT_FOUND") {
    super(message);
    this.name = "RigRateError";
  }
}

/**
 * Cloneable, in-process reference-rate calculator. It does not fetch boards, verify payments,
 * attest hardware, custody funds, or determine a market price. Callers are responsible for
 * source authentication and may only mark an observation settled after independent verification.
 */
export function createRigRate(options: RigRateOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const maxAgeSeconds = options.maxAgeSeconds ?? 7 * 24 * 60 * 60;
  const minObservations = options.minObservations ?? 3;
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 60 || !Number.isSafeInteger(minObservations) || minObservations < 1) {
    throw new RigRateError("maxAgeSeconds must be at least 60 and minObservations at least 1", "INVALID_OBSERVATION");
  }
  const observations = new Map<string, RigRateObservation>();

  function record(observation: RigRateObservation): RigRateObservation {
    validateObservation(observation, now());
    if (observations.has(observation.id)) throw new RigRateError("Observation ID already exists", "DUPLICATE_OBSERVATION");
    const stored = structuredClone(observation);
    observations.set(stored.id, stored);
    return structuredClone(stored);
  }

  function quote(gpuClass: string, priceAsset: string): RigRate {
    if (!gpuClass.trim() || !priceAsset.trim()) throw new RigRateError("gpuClass and priceAsset are required", "INVALID_OBSERVATION");
    const cutoff = now() - maxAgeSeconds * 1000;
    const matches = [...observations.values()].filter((observation) =>
      observation.gpuClass === gpuClass && observation.priceAsset === priceAsset && Date.parse(observation.observedAt) >= cutoff,
    );
    if (matches.length === 0) throw new RigRateError("No current observations for this GPU class and price asset", "NOT_FOUND");
    const hourly = matches.map(hourlyAmount).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const middle = hourly.length >> 1;
    const median = hourly.length % 2 === 1
      ? hourly[middle]!
      : roundHalfUp(hourly[middle - 1]! + hourly[middle]!, 2n);
    const sources = [...new Set(matches.map((observation) => observation.source))].sort() as RigRateSource[];
    const flags: RigRateFlag[] = [];
    if (matches.length < minObservations) flags.push("thin-market");
    if (sources.length === 1) flags.push("single-source");
    if (matches.some((observation) => !observation.settled)) flags.push("low-quality");
    if (matches.every((observation) => Date.parse(observation.observedAt) < now() - maxAgeSeconds * 500)) flags.push("stale");
    return {
      gpuClass, priceAsset, pricePerGpuHour: median.toString(),
      observedAt: new Date(now()).toISOString(), observations: matches.length, sources, flags,
    };
  }

  function history(gpuClass: string, priceAsset: string): RigRateObservation[] {
    return [...observations.values()]
      .filter((observation) => observation.gpuClass === gpuClass && observation.priceAsset === priceAsset)
      .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
      .map((observation) => structuredClone(observation));
  }

  return { record, quote, history };
}

function validateObservation(observation: RigRateObservation, current: number): void {
  if (!observation || typeof observation !== "object" ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(observation.id) ||
      !/^[A-Za-z0-9_.:/-]{1,256}$/.test(observation.sourceReference) ||
      !["booths", "lamps", "public-board"].includes(observation.source) ||
      !observation.gpuClass.trim() || observation.gpuClass.length > 120 ||
      !/^[A-Za-z0-9_.:-]{1,96}$/.test(observation.priceAsset) ||
      !/^[1-9]\d{0,77}$/.test(observation.priceAmount) || BigInt(observation.priceAmount) >= 2n ** 256n ||
      !Number.isSafeInteger(observation.durationSeconds) || observation.durationSeconds < 60 || observation.durationSeconds > 31_536_000 ||
      !Number.isSafeInteger(observation.gpuCount) || observation.gpuCount < 1 || observation.gpuCount > 65_536 ||
      typeof observation.settled !== "boolean") {
    throw new RigRateError("Observation fields are invalid", "INVALID_OBSERVATION");
  }
  const observed = parseUtc(observation.observedAt);
  if (observed > current + 5 * 60_000) throw new RigRateError("observedAt cannot be more than five minutes in the future", "INVALID_OBSERVATION");
}

function hourlyAmount(observation: RigRateObservation): bigint {
  return roundHalfUp(BigInt(observation.priceAmount) * 3600n, BigInt(observation.durationSeconds) * BigInt(observation.gpuCount));
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function parseUtc(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(parsed).toISOString() !== value) {
    throw new RigRateError("observedAt must be a canonical ISO UTC timestamp", "INVALID_OBSERVATION");
  }
  return parsed;
}
