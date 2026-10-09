export type BoothsTask = "inference" | "fine-tune" | (string & {});

export interface BoothsWorkload<TInput = Record<string, unknown>> {
  /** Supplied by the integrator for tracing and safe retries; not sent anywhere by this runtime. */
  requestId: string;
  task: BoothsTask;
  model: string;
  input: TInput;
  options?: Record<string, unknown>;
}

export interface BoothsCapabilities {
  provider: string;
  devices: string[];
  tasks: string[];
  /** Informational capability; enforcement remains provider-specific. */
  maxBatchSize?: number;
}

export interface BoothsExecutionContext {
  signal: AbortSignal;
}

export interface BoothsProvider<TInput = unknown, TOutput = unknown> {
  capabilities(): Promise<BoothsCapabilities> | BoothsCapabilities;
  execute(
    workload: BoothsWorkload<TInput>,
    context: BoothsExecutionContext,
  ): Promise<{ output: TOutput; usage?: Record<string, number | string> }>;
}

export interface BoothsResult<TOutput = unknown> {
  requestId: string;
  task: string;
  model: string;
  output: TOutput;
  provider: BoothsCapabilities;
  elapsedMs: number;
  usage?: Record<string, number | string>;
}

export interface BoothsRuntimeOptions {
  provider: BoothsProvider;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export class BoothsError extends Error {
  constructor(message: string, public readonly code: "INVALID_WORKLOAD" | "UNSUPPORTED_TASK" | "INPUT_TOO_LARGE" | "OUTPUT_TOO_LARGE" | "TIMEOUT" | "PROVIDER_ERROR") {
    super(message);
    this.name = "BoothsError";
  }
}

/**
 * In-process Booths runtime. No network, queue, database, telemetry, or credentials are used;
 * the integrator supplies a provider backed by their own CPU/GPU hardware.
 */
export function createBoothsRuntime(options: BoothsRuntimeOptions) {
  const maxInputBytes = options.maxInputBytes ?? 256 * 1024;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;

  return {
    capabilities: () => options.provider.capabilities(),

    async run<TInput extends Record<string, unknown>, TOutput = unknown>(
      workload: BoothsWorkload<TInput>,
      signal?: AbortSignal,
    ): Promise<BoothsResult<TOutput>> {
      if (!workload || typeof workload !== "object" ||
          !/^[A-Za-z0-9_.:-]{1,128}$/.test(workload.requestId) ||
          typeof workload.task !== "string" || !/^[a-z][a-z0-9._-]{0,79}$/.test(workload.task) ||
          typeof workload.model !== "string" || workload.model.trim().length < 1 || workload.model.length > 256 ||
          !workload.input || typeof workload.input !== "object") {
        throw new BoothsError("requestId, task, model, and object input are required", "INVALID_WORKLOAD");
      }
      const inputBytes = encodedSize({ input: workload.input, options: workload.options ?? {} });
      if (inputBytes > maxInputBytes) throw new BoothsError(`Workload exceeds ${maxInputBytes} input bytes`, "INPUT_TOO_LARGE");
      const provider = await options.provider.capabilities();
      if (!provider.tasks.includes("*") && !provider.tasks.includes(workload.task)) {
        throw new BoothsError(`Provider does not support task ${workload.task}`, "UNSUPPORTED_TASK");
      }

      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const start = performance.now();
      try {
        const execution = options.provider.execute(workload, { signal: controller.signal });
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(new Error("Booths execution timed out"));
            reject(new BoothsError(`Execution exceeded ${timeoutMs} ms`, "TIMEOUT"));
          }, timeoutMs);
        });
        const result = await Promise.race([execution, timeout]);
        if (encodedSize(result.output) > maxOutputBytes) {
          throw new BoothsError(`Provider output exceeds ${maxOutputBytes} bytes`, "OUTPUT_TOO_LARGE");
        }
        return {
          requestId: workload.requestId,
          task: workload.task,
          model: workload.model,
          output: result.output as TOutput,
          provider,
          elapsedMs: Math.max(0, Math.round(performance.now() - start)),
          ...(result.usage ? { usage: result.usage } : {}),
        };
      } catch (error) {
        if (error instanceof BoothsError) throw error;
        if (signal?.aborted) throw new BoothsError("Execution was cancelled", "PROVIDER_ERROR");
        throw new BoothsError(error instanceof Error ? error.message : "Provider execution failed", "PROVIDER_ERROR");
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

function encodedSize(value: unknown): number {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("not JSON serializable");
    return new TextEncoder().encode(encoded).byteLength;
  } catch {
    throw new BoothsError("Workload and result values must be JSON-serializable", "INVALID_WORKLOAD");
  }
}
