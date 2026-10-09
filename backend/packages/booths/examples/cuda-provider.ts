import { spawn } from "node:child_process";
import type { BoothsCapabilities, BoothsProvider, BoothsWorkload } from "../src";

/** Example provider: invoke a locally installed PyTorch/Transformers CUDA worker. */
export class PythonCudaProvider implements BoothsProvider {
  constructor(
    private readonly workerPath: string,
    private readonly modelDirectory: string,
    private readonly python = "python3",
  ) {}

  async capabilities(): Promise<BoothsCapabilities> {
    return await this.invoke({ operation: "capabilities" }) as BoothsCapabilities;
  }

  async execute(workload: BoothsWorkload, context: { signal: AbortSignal }) {
    return await this.invoke({ operation: "execute", workload }, context.signal) as {
      output: unknown;
      usage?: Record<string, number | string>;
    };
  }

  private invoke(input: unknown, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, [this.workerPath], {
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, BOOTHS_MODEL_DIR: this.modelDirectory },
      });
      const chunks: Uint8Array[] = [];
      let total = 0;
      child.stdout.on("data", (chunk: Uint8Array) => {
        total += chunk.byteLength;
        if (total > 2 * 1024 * 1024) {
          child.kill("SIGKILL");
          reject(new Error("CUDA provider output exceeded 2 MB"));
          return;
        }
        chunks.push(chunk);
      });
      child.once("error", reject);
      child.once("close", (code) => {
        signal?.removeEventListener("abort", abort);
        if (code !== 0) return reject(new Error(`CUDA provider exited with status ${code}`));
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new Error("CUDA provider returned invalid JSON"));
        }
      });
      const abort = () => child.kill("SIGTERM");
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      child.stdin.end(JSON.stringify(input));
    });
  }
}
