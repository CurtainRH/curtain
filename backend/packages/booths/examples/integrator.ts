import { createBoothsRuntime } from "../src";
import { PythonCudaProvider } from "./cuda-provider";

const modelDirectory = process.env["BOOTHS_MODEL_DIR"];
if (!modelDirectory) throw new Error("Set BOOTHS_MODEL_DIR to a directory containing a locally installed model");

const booths = createBoothsRuntime({
  provider: new PythonCudaProvider(
    process.env["BOOTHS_PYTHON"] ?? "python3",
    new URL("./torch_worker.py", import.meta.url).pathname,
    modelDirectory,
  ),
  timeoutMs: 5 * 60_000,
});

// Call this function from your own application service. Nothing is sent to Curtain.
export async function generate(prompt: string) {
  return booths.run({
    requestId: crypto.randomUUID(),
    task: "inference",
    model: "your-model-directory-name",
    input: { prompt },
    options: { maxNewTokens: 128 },
  });
}

if (import.meta.main) {
  const prompt = process.argv[2];
  if (!prompt) throw new Error("Usage: bun run examples/integrator.ts 'your prompt'");
  console.log(JSON.stringify(await generate(prompt), null, 2));
}
