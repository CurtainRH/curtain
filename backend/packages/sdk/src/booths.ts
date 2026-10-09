/**
 * Server-side client and worker loop for the experimental Booths compute-job API.
 * Never ship API or worker credentials in browser bundles.
 */

export interface BoothsJob<TInput = unknown, TOutput = unknown> {
  id: string;
  task: string;
  status: "queued" | "running" | "succeeded" | "failed";
  input?: TInput;
  output?: TOutput;
  error?: string;
  attempts?: number;
  experimental?: boolean;
}

type BoothsFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface BoothsClientOptions {
  baseUrl: string;
  apiKey: string;
  fetcher?: BoothsFetch;
}

export function createBoothsClient(options: BoothsClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const fetcher = options.fetcher ?? fetch;
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetcher(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    const data = await response.json() as T | { error?: string };
    if (!response.ok) throw new Error((data as { error?: string }).error ?? `Booths API error (${response.status})`);
    return data as T;
  }
  return {
    submit<TInput extends object>(task: string, input: TInput, idempotencyKey: string) {
      return call<BoothsJob<TInput>>(`/v1/compute/jobs`, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify({ task, input }),
      });
    },
    get<TOutput = unknown>(jobId: string) {
      if (!/^[a-f0-9]{32}$/.test(jobId)) throw new Error("Invalid Booths job ID");
      return call<BoothsJob<unknown, TOutput>>(`/v1/compute/jobs/${jobId}`);
    },
  };
}

export interface BoothsWorkerOptions {
  baseUrl: string;
  workerToken: string;
  /** Explicit allowlist: task names absent from this map are rejected. */
  handlers: Record<string, (input: unknown) => Promise<unknown> | unknown>;
  pollMs?: number;
  fetcher?: BoothsFetch;
  onError?: (error: unknown) => void;
}

/** Start a long-polling worker in a server process; returns a stop function. */
export function startBoothsWorker(options: BoothsWorkerOptions): () => void {
  const base = options.baseUrl.replace(/\/+$/, "");
  const fetcher = options.fetcher ?? fetch;
  const pollMs = options.pollMs ?? 1000;
  let stopped = false;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const workerCall = async (path: string, body?: unknown) => {
    const response = await fetcher(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.workerToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Booths worker API error (${response.status})`);
    return data;
  };
  void (async () => {
    while (!stopped) {
      try {
        const claimed = await workerCall("/v1/compute/worker/claim") as {
          job?: { id: string; task: string; input: unknown } | null;
          leaseSeconds?: number;
        };
        if (!claimed.job) {
          await wait(pollMs);
          continue;
        }
        const job = claimed.job;
        const heartbeat = setInterval(() => {
          void workerCall(`/v1/compute/worker/jobs/${job.id}/heartbeat`).catch((error) => options.onError?.(error));
        }, Math.max(10_000, Math.floor((claimed.leaseSeconds ?? 180) * 500)));
        const handler = options.handlers[job.task];
        if (!handler) {
          clearInterval(heartbeat);
          await workerCall(`/v1/compute/worker/jobs/${job.id}/fail`, { error: `Unsupported task: ${job.task}` });
          continue;
        }
        try {
          const output = await handler(job.input);
          clearInterval(heartbeat);
          await workerCall(`/v1/compute/worker/jobs/${job.id}/complete`, { output });
        } catch (error) {
          clearInterval(heartbeat);
          const message = error instanceof Error ? error.message : "Task handler failed";
          await workerCall(`/v1/compute/worker/jobs/${job.id}/fail`, { error: message.slice(0, 500) });
        }
      } catch (error) {
        options.onError?.(error);
        await wait(pollMs);
      }
    }
  })();
  return () => { stopped = true; };
}
