export type AnalysisValue = string | number | boolean | null;
export type AnalysisRow = Record<string, AnalysisValue>;

export type PrivateAnalysisQuery =
  | { operation: "count" }
  | { operation: "sum" | "mean"; field: string }
  | { operation: "group-count"; groupBy: string }
  | { operation: "group-sum"; groupBy: string; field: string };

export interface PrivateAnalysisPolicy {
  /** Only these fields may be used as categorical group keys. */
  dimensions: readonly string[];
  /** Only these numeric fields may be summed or averaged. */
  measures: readonly string[];
  /** Entire datasets and individual groups below this size are not returned. Defaults to 5. */
  minimumCohortSize?: number;
  /** Hard cap on rows read for a single request. Defaults to 100,000. */
  maximumRows?: number;
  /** Hard cap on distinct group keys held in memory. Defaults to 500. */
  maximumGroups?: number;
}

export interface PrivateAnalysisSource {
  /** Open a dataset inside the integrator's own service; do not return data from an untrusted host. */
  open(datasetId: string, context: { signal: AbortSignal }): AsyncIterable<AnalysisRow>;
}

export interface PrivateAnalysisRequest {
  requestId: string;
  datasetId: string;
  query: PrivateAnalysisQuery;
}

export type PrivateAnalysisResult =
  | { requestId: string; datasetId: string; operation: "count"; value: number; elapsedMs: number }
  | { requestId: string; datasetId: string; operation: "sum" | "mean"; value: number; cohortSize: number; elapsedMs: number }
  | {
      requestId: string;
      datasetId: string;
      operation: "group-count" | "group-sum";
      groups: Array<{ key: string; value: number; cohortSize: number }>;
      suppressedGroups: number;
      elapsedMs: number;
    };

export type PrivateAnalysisErrorCode =
  | "INVALID_REQUEST"
  | "FIELD_NOT_ALLOWED"
  | "INVALID_ROW"
  | "ROW_LIMIT"
  | "GROUP_LIMIT"
  | "INSUFFICIENT_COHORT"
  | "CANCELLED";

export class PrivateAnalysisError extends Error {
  constructor(message: string, public readonly code: PrivateAnalysisErrorCode) {
    super(message);
    this.name = "PrivateAnalysisError";
  }
}

export interface PrivateAnalysisOptions {
  source: PrivateAnalysisSource;
  policy: PrivateAnalysisPolicy;
}

/**
 * Small in-process aggregate-analysis toolkit. It reads rows from the integrator's source,
 * accepts only a constrained query shape, and returns aggregate results—not source rows.
 * It is not differential privacy, encryption, a TEE, or a guarantee against repeated-query
 * inference. Integrators own authorization, source isolation, query auditing, and deployment.
 */
export function createPrivateAnalysisToolkit(options: PrivateAnalysisOptions) {
  if (!options?.source || typeof options.source.open !== "function" ||
      !Array.isArray(options.policy?.dimensions) || !Array.isArray(options.policy?.measures)) {
    throw new PrivateAnalysisError("A dataset source and field policy are required", "INVALID_REQUEST");
  }
  const minimumCohortSize = options.policy.minimumCohortSize ?? 5;
  const maximumRows = options.policy.maximumRows ?? 100_000;
  const maximumGroups = options.policy.maximumGroups ?? 500;
  if (!Number.isSafeInteger(minimumCohortSize) || minimumCohortSize < 2 ||
      !Number.isSafeInteger(maximumRows) || maximumRows < minimumCohortSize ||
      !Number.isSafeInteger(maximumGroups) || maximumGroups < 1) {
    throw new PrivateAnalysisError("Analysis policy limits are invalid", "INVALID_REQUEST");
  }

  return {
    async run(request: PrivateAnalysisRequest, signal?: AbortSignal): Promise<PrivateAnalysisResult> {
      if (!request || typeof request !== "object" ||
          typeof request.requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(request.requestId) ||
          typeof request.datasetId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(request.datasetId) ||
          !request.query || typeof request.query !== "object") {
        throw new PrivateAnalysisError("requestId, datasetId, and a query are required", "INVALID_REQUEST");
      }
      const { query } = request;
      if (query.operation === "sum" || query.operation === "mean" || query.operation === "group-sum") {
        if (!options.policy.measures.includes(query.field)) {
          throw new PrivateAnalysisError(`Measure field ${query.field} is not allowed`, "FIELD_NOT_ALLOWED");
        }
      }
      if (query.operation === "group-count" || query.operation === "group-sum") {
        if (!options.policy.dimensions.includes(query.groupBy)) {
          throw new PrivateAnalysisError(`Group field ${query.groupBy} is not allowed`, "FIELD_NOT_ALLOWED");
        }
      }
      if (!["count", "sum", "mean", "group-count", "group-sum"].includes(query.operation)) {
        throw new PrivateAnalysisError("Unsupported analysis operation", "INVALID_REQUEST");
      }

      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      const started = performance.now();
      let rowCount = 0;
      let total = 0;
      const groups = new Map<string, { label: string; count: number; total: number }>();

      try {
        for await (const row of options.source.open(request.datasetId, { signal: controller.signal })) {
          if (signal?.aborted) throw new PrivateAnalysisError("Analysis was cancelled", "CANCELLED");
          if (!row || typeof row !== "object" || Array.isArray(row)) {
            throw new PrivateAnalysisError("Source returned a non-object row", "INVALID_ROW");
          }
          rowCount += 1;
          if (rowCount > maximumRows) throw new PrivateAnalysisError(`Dataset exceeds ${maximumRows} rows`, "ROW_LIMIT");

          let numericValue: number | undefined;
          if (query.operation === "sum" || query.operation === "mean" || query.operation === "group-sum") {
            const raw = row[query.field];
            if (typeof raw !== "number" || !Number.isFinite(raw)) {
              throw new PrivateAnalysisError(`Row ${rowCount} has a missing or non-numeric ${query.field}`, "INVALID_ROW");
            }
            numericValue = raw;
            total += raw;
            if (!Number.isFinite(total)) throw new PrivateAnalysisError("Aggregate exceeded numeric range", "INVALID_ROW");
          }

          if (query.operation === "group-count" || query.operation === "group-sum") {
            const rawKey = row[query.groupBy];
            if (rawKey === null || rawKey === undefined || !["string", "number", "boolean"].includes(typeof rawKey)) {
              throw new PrivateAnalysisError(`Row ${rowCount} has an invalid group value for ${query.groupBy}`, "INVALID_ROW");
            }
            const encodedKey = `${typeof rawKey}:${String(rawKey)}`;
            let group = groups.get(encodedKey);
            if (!group) {
              if (groups.size >= maximumGroups) throw new PrivateAnalysisError(`Analysis exceeds ${maximumGroups} groups`, "GROUP_LIMIT");
              group = { label: String(rawKey), count: 0, total: 0 };
              groups.set(encodedKey, group);
            }
            group.count += 1;
            if (numericValue !== undefined) {
              group.total += numericValue;
              if (!Number.isFinite(group.total)) throw new PrivateAnalysisError("Group aggregate exceeded numeric range", "INVALID_ROW");
            }
          }
        }

        if (signal?.aborted) throw new PrivateAnalysisError("Analysis was cancelled", "CANCELLED");
        if (rowCount < minimumCohortSize) {
          throw new PrivateAnalysisError(`At least ${minimumCohortSize} records are required`, "INSUFFICIENT_COHORT");
        }
        const elapsedMs = Math.max(0, Math.round(performance.now() - started));
        if (query.operation === "count") return { requestId: request.requestId, datasetId: request.datasetId, operation: "count", value: rowCount, elapsedMs };
        if (query.operation === "sum" || query.operation === "mean") {
          return { requestId: request.requestId, datasetId: request.datasetId, operation: query.operation, value: query.operation === "mean" ? total / rowCount : total, cohortSize: rowCount, elapsedMs };
        }
        const visible = [...groups.values()].filter(group => group.count >= minimumCohortSize);
        const suppressedGroups = groups.size - visible.length;
        return {
          requestId: request.requestId,
          datasetId: request.datasetId,
          operation: query.operation,
          groups: visible.map(group => ({
            key: group.label,
            value: query.operation === "group-sum" ? group.total : group.count,
            cohortSize: group.count,
          })),
          suppressedGroups,
          elapsedMs,
        };
      } catch (error) {
        if (signal?.aborted && !(error instanceof PrivateAnalysisError)) {
          throw new PrivateAnalysisError("Analysis was cancelled", "CANCELLED");
        }
        throw error;
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
