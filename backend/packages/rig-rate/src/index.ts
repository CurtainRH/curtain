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
  /** Normalized source region. Omitted legacy observations are treated as `global`. */
  region?: string;
}

export interface RigRateQuery {
  gpuClass: string;
  priceAsset: string;
  region: string;
  windowStart: string;
  windowEnd: string;
}

export interface RigRateSourceAdapter {
  id: string;
  /** Fetches caller-authenticated records; the adapter never implies the records are verified. */
  fetch(query: RigRateQuery): Promise<RigRateObservation[]>;
}

/** Optional persistence port. Storage, retries, and source authentication remain integrator-owned. */
export interface RigRateStore {
  put(observation: RigRateObservation): Promise<void>;
  list(query: RigRateQuery): Promise<RigRateObservation[]>;
}

export type RigRateStatus = "ok" | "thin_market" | "insufficient_data";

export interface RigRateEvaluation {
  status: RigRateStatus;
  gpuClass: string;
  priceAsset: string;
  region: string;
  windowStart: string;
  windowEnd: string;
  pricePerGpuHour?: string;
  observations: number;
  sources: RigRateSource[];
  provenance: { observationIds: string[]; sourceReferences: string[]; excludedObservationIds: string[] };
  confidence: { score: number; reasons: string[] };
}

export interface RigRateOptions {
  now?: () => number;
  /** Ignore observations older than this period. Defaults to seven days. */
  maxAgeSeconds?: number;
  /** A rate below this number of observations is marked thin-market. Defaults to three. */
  minObservations?: number;
  /** Exclude observations whose normalized hourly rate differs from the median by more than this. */
  maxOutlierDeviationBps?: number;
  store?: RigRateStore;
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
  const maxOutlierDeviationBps = options.maxOutlierDeviationBps ?? 3_000;
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 60 || !Number.isSafeInteger(minObservations) || minObservations < 1 ||
      !Number.isSafeInteger(maxOutlierDeviationBps) || maxOutlierDeviationBps < 0 || maxOutlierDeviationBps > 10_000) {
    throw new RigRateError("maxAgeSeconds must be at least 60 and minObservations at least 1", "INVALID_OBSERVATION");
  }
  const observations = new Map<string, RigRateObservation>();

  function record(observation: RigRateObservation): RigRateObservation {
    validateObservation(observation, now());
    if (observations.has(observation.id)) throw new RigRateError("Observation ID already exists", "DUPLICATE_OBSERVATION");
    const stored = { ...structuredClone(observation), region: observation.region ?? "global" };
    observations.set(stored.id, stored);
    return structuredClone(stored);
  }

  function quote(gpuClass: string, priceAsset: string): RigRate {
    if (!gpuClass.trim() || !priceAsset.trim()) throw new RigRateError("gpuClass and priceAsset are required", "INVALID_OBSERVATION");
    const result = evaluate({ gpuClass, priceAsset, region: "global", windowStart: new Date(now() - maxAgeSeconds * 1000).toISOString(), windowEnd: new Date(now()).toISOString() });
    if (!result.pricePerGpuHour) throw new RigRateError("No current observations for this GPU class and price asset", "NOT_FOUND");
    const flags: RigRateFlag[] = [];
    if (result.status === "thin_market") flags.push("thin-market");
    if (result.sources.length === 1) flags.push("single-source");
    const selected = result.provenance.observationIds.map((id) => observations.get(id)!);
    if (selected.some((observation) => !observation.settled)) flags.push("low-quality");
    if (selected.every((observation) => Date.parse(observation.observedAt) < now() - maxAgeSeconds * 500)) flags.push("stale");
    return {
      gpuClass, priceAsset, pricePerGpuHour: result.pricePerGpuHour,
      observedAt: new Date(now()).toISOString(), observations: result.observations, sources: result.sources, flags,
    };
  }

  function evaluate(query: RigRateQuery): RigRateEvaluation {
    const start = parseUtc(query.windowStart); const end = parseUtc(query.windowEnd);
    if (!query.gpuClass.trim() || !query.priceAsset.trim() || !validRegion(query.region) || end <= start) throw new RigRateError("Rig Rate query is invalid", "INVALID_OBSERVATION");
    const cutoff = now() - maxAgeSeconds * 1000;
    const matches = [...observations.values()].filter((observation) => observation.gpuClass === query.gpuClass && observation.priceAsset === query.priceAsset &&
      (observation.region ?? "global") === query.region && Date.parse(observation.observedAt) >= cutoff && Date.parse(observation.observedAt) >= start && Date.parse(observation.observedAt) <= end);
    const base = { gpuClass: query.gpuClass, priceAsset: query.priceAsset, region: query.region, windowStart: query.windowStart, windowEnd: query.windowEnd };
    if (matches.length === 0) return { ...base, status: "insufficient_data", observations: 0, sources: [], provenance: { observationIds: [], sourceReferences: [], excludedObservationIds: [] }, confidence: { score: 0, reasons: ["no observations in the requested window"] } };
    const raw = matches.map((observation) => ({ observation, hourly: hourlyAmount(observation) }));
    const rawMedian = median(raw.map((entry) => entry.hourly));
    const included = raw.filter((entry) => deviationBps(entry.hourly, rawMedian) <= BigInt(maxOutlierDeviationBps));
    const excluded = raw.filter((entry) => !included.includes(entry)).map((entry) => entry.observation.id);
    const sources = [...new Set(included.map((entry) => entry.observation.source))].sort() as RigRateSource[];
    const reasons: string[] = [];
    let score = 100;
    if (excluded.length) { reasons.push(`${excluded.length} outlier observation(s) excluded`); score -= Math.min(30, excluded.length * 10); }
    if (included.length < minObservations) { reasons.push("fewer observations than the configured minimum"); score -= 35; }
    if (sources.length < 2) { reasons.push("single-source input"); score -= 25; }
    if (included.some((entry) => !entry.observation.settled)) { reasons.push("includes indicative or unverified settlement data"); score -= 15; }
    const status: RigRateStatus = included.length === 0 ? "insufficient_data" : included.length < minObservations ? "thin_market" : "ok";
    const provenance = { observationIds: included.map((entry) => entry.observation.id), sourceReferences: included.map((entry) => entry.observation.sourceReference), excludedObservationIds: excluded };
    return { ...base, status, ...(included.length ? { pricePerGpuHour: median(included.map((entry) => entry.hourly)).toString() } : {}), observations: included.length, sources, provenance, confidence: { score: Math.max(0, score), reasons } };
  }

  async function ingest(adapter: RigRateSourceAdapter, query: RigRateQuery): Promise<RigRateObservation[]> {
    if (!adapter || !safeAdapterId(adapter.id) || typeof adapter.fetch !== "function") throw new RigRateError("Rig Rate source adapter is invalid", "INVALID_OBSERVATION");
    const fetched = await adapter.fetch(structuredClone(query));
    if (!Array.isArray(fetched)) throw new RigRateError("Rig Rate adapter returned invalid data", "INVALID_OBSERVATION");
    const stored = fetched.map(record);
    if (options.store) for (const observation of stored) await options.store.put(structuredClone(observation));
    return stored.map((observation) => structuredClone(observation));
  }

  async function load(query: RigRateQuery): Promise<RigRateObservation[]> {
    if (!options.store) throw new RigRateError("No Rig Rate store is configured", "NOT_FOUND");
    const loaded = await options.store.list(structuredClone(query));
    if (!Array.isArray(loaded)) throw new RigRateError("Rig Rate store returned invalid data", "INVALID_OBSERVATION");
    const result: RigRateObservation[] = [];
    for (const observation of loaded) {
      if (observations.has(observation.id)) continue;
      result.push(record(observation));
    }
    return result;
  }

  function history(gpuClass: string, priceAsset: string): RigRateObservation[] {
    return [...observations.values()]
      .filter((observation) => observation.gpuClass === gpuClass && observation.priceAsset === priceAsset)
      .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
      .map((observation) => structuredClone(observation));
  }

  return { record, quote, evaluate, ingest, load, history };
}

function validateObservation(observation: RigRateObservation, current: number): void {
  if (!observation || typeof observation !== "object" ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(observation.id) ||
      !/^[A-Za-z0-9_.:/-]{1,256}$/.test(observation.sourceReference) ||
      !["booths", "lamps", "public-board"].includes(observation.source) ||
      !observation.gpuClass.trim() || observation.gpuClass.length > 120 ||
      (observation.region !== undefined && !validRegion(observation.region)) ||
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

function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0); const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : roundHalfUp(sorted[middle - 1]! + sorted[middle]!, 2n);
}
function deviationBps(value: bigint, center: bigint): bigint { return center === 0n ? 0n : (abs(value - center) * 10_000n) / center; }
function abs(value: bigint): bigint { return value < 0n ? -value : value; }
function validRegion(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value); }
function safeAdapterId(value: string): boolean { return /^[A-Za-z0-9_.:-]{1,128}$/.test(value); }

function parseUtc(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(parsed).toISOString() !== value) {
    throw new RigRateError("observedAt must be a canonical ISO UTC timestamp", "INVALID_OBSERVATION");
  }
  return parsed;
}
