# Booths runtime — experimental

Booths is cloneable runtime code for integrating compute into your own service. It is not a Curtain-hosted API or job service. Your application calls the runtime in-process, and you supply a provider connected to the hardware you control.

The core package is deliberately hardware-neutral. Implement `BoothsProvider` to connect CUDA, ROCm, Metal, a local accelerator, or another execution environment. The included PyTorch example shows one way to attach a CUDA GPU. It requires a CUDA-capable machine, locally installed model weights, PyTorch, and Transformers; none of those are included or provided by Curtain.

No jobs, prompts, model names, telemetry, or credentials are sent to Curtain. The runtime does not include a remote queue, hosted model, billing, attestation, or privacy guarantee. Treat this as experimental integration code and review the provider you run.

## Use the package from a clone

Clone the Curtain repository, then work from the backend workspace:

```sh
git clone https://github.com/CurtainRH/curtain.git
cd curtain/backend
bun install
bun run --filter @curtain/booths test
bun run --filter @curtain/booths typecheck
```

In your own monorepo, copy `backend/packages/booths` into your workspace and add it as a local workspace dependency, or vendor its small `src/` directory. Then call the runtime directly from your service:

```ts
import { createBoothsRuntime } from "@curtain/booths";

const booths = createBoothsRuntime({ provider: yourGpuProvider });
const result = await booths.run({
  requestId: crypto.randomUUID(),
  task: "inference",
  model: "local-model-id",
  input: { prompt: "Summarize this text." },
});
```

`yourGpuProvider` implements `capabilities()` and `execute(workload, { signal })`. The runtime validates request IDs and task names, bounds serialized input/output sizes, enforces a timeout, and rejects unsupported tasks before dispatch.

## CUDA example

The `examples/` directory includes a small PyTorch + Transformers provider that only loads model weights from a local directory and refuses to silently fall back to CPU. It does not support fine-tuning yet.

On a machine with a compatible NVIDIA driver and CUDA-enabled PyTorch installation:

```sh
python3 -m pip install torch transformers
export BOOTHS_MODEL_DIR=/opt/models
export BOOTHS_PYTHON=python3
bun run examples/integrator.ts "Explain the provided input"
```

Place a previously downloaded, reviewed model under `/opt/models/your-model-directory-name`; the example sets `local_files_only=True` and `trust_remote_code=False`. Install a PyTorch build compatible with the GPU and driver on the host. The Curtain CI suite uses CPU mocks only and does not attest or certify a GPU.

## Verify locally without a GPU

The unit tests use an in-memory CPU provider to validate the interface and safety bounds. They do not emulate GPU performance or prove the CUDA adapter works on a particular host.
