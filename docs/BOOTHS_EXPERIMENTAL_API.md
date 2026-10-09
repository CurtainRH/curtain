# Booths Experimental Compute API

Booths is an experimental, integrator-facing job queue for applications that need an asynchronous compute boundary. It accepts JSON jobs, persists them, and lets an authenticated worker claim and complete them. Integrators call the same API from their backend; workers can be operated separately and replaced without changing the application-facing request format.

## Current boundary

- This is a job queue and worker protocol, not a hosted model or arbitrary-code execution service.
- The initial worker interface is CPU-compatible. There is no GPU allocation, confidential-compute attestation, or private-inference guarantee in this release.
- Do not submit secrets, private keys, or sensitive prompts. Job payloads are stored in the operator database while queued and become inaccessible through the API 24 hours after completion/failure; physical deletion happens opportunistically on subsequent API traffic.
- GitHub-hosted Actions are for Curtain's internal CI/prototype validation, not an advertised customer GPU service.
- The endpoint is disabled unless the operator has `FEATURE_BOOTHS=true` and `BOOTHS_WORKER_TOKEN` configured.

## Integrator API

Use a Curtain Developer API key as a bearer credential. Submit JSON to `POST https://operator.curtainrh.com/v1/compute/jobs`; the task identifier is application-defined, but workers should only execute task types they explicitly support.

```http
POST /v1/compute/jobs HTTP/1.1
Authorization: Bearer ctn_live_...
Idempotency-Key: report-2026-10-09-001
Content-Type: application/json

{"task":"my-service.summarize","input":{"documentId":"doc_123"}}
```

The API returns `202` with a job ID. Poll `GET /v1/compute/jobs/{id}` using the same API key. A key can have up to 20 active jobs; payload and result objects are limited to 48 KB, and API keys retain the existing 60-request/minute limit. Reusing an idempotency key with different task/input returns `409`.

## Worker protocol

The runner authenticates with the separate `BOOTHS_WORKER_TOKEN` secret:

1. `POST /v1/compute/worker/claim` to atomically claim the oldest queued job.
2. Execute only the claimed task using an explicit local handler/allowlist.
3. Heartbeat long-running jobs with `POST /v1/compute/worker/jobs/{id}/heartbeat`.
4. `POST /v1/compute/worker/jobs/{id}/complete` with `{ "output": ... }`, or `/fail` with `{ "error": "..." }`.

Claims are leased for three minutes by default. An expired lease returns the job to the queue. After three expired leases the job is marked failed. Keep the worker token server-side; never put it in browser code, logs, or integrator application responses. Worker inputs and results are not logged by this API.

The server-side client and allowlisted worker loop are available from `@curtain/sdk/booths`:

```ts
import { createBoothsClient, startBoothsWorker } from "@curtain/sdk/booths";

const booths = createBoothsClient({
  baseUrl: "https://operator.curtainrh.com",
  apiKey: process.env.CURTAIN_API_KEY!,
});
const job = await booths.submit("demo.hash", { value: "hello" }, "request-123");
const result = await booths.get(job.id);

const stop = startBoothsWorker({
  baseUrl: "https://operator.curtainrh.com",
  workerToken: process.env.BOOTHS_WORKER_TOKEN!,
  handlers: { "demo.hash": async (input) => ({ received: input }) },
});
// call stop() during graceful shutdown
```

In real integrations, submit from a trusted backend and poll until a terminal state rather than immediately calling `get` once. The SDK worker loop is intended for a server-side runner you control; it is not a browser component.

## Enablement

On the operator service only:

```env
FEATURE_BOOTHS=true
BOOTHS_WORKER_TOKEN=<long-random-server-side-secret>
```

The shared database migration creates the queue table on operator startup. The queue is still experimental: deploy only after testing worker connectivity, key authorization, retention, and your task handlers in a non-production environment.
