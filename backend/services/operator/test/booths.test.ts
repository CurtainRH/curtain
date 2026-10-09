import { createHash } from "node:crypto";
import { beforeAll, describe, expect, test } from "bun:test";
import { migrate, type Db } from "@curtain/db";
import { pgliteDb } from "@curtain/db/pglite";
import { createBoothsApi } from "../src/booths";

const apiKey = `ctn_live_${"a".repeat(43)}`;
const workerToken = "test-worker-secret";
let db: Db;
let handle: ReturnType<typeof createBoothsApi>;
let jobId = "";
let seq = 0;

async function request(path: string, options: { method?: string; body?: unknown; auth?: string; idem?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.auth) headers.authorization = `Bearer ${options.auth}`;
  if (options.idem) headers["idempotency-key"] = options.idem;
  const response = await handle(new Request(`https://operator.test${path}`, {
    method: options.method ?? "GET", headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }));
  if (!response) throw new Error(`No handler for ${path}`);
  return response;
}

beforeAll(async () => {
  db = await pgliteDb();
  await migrate(db);
  await db.query("INSERT INTO developer_wallets(wallet) VALUES ($1)", ["0x0000000000000000000000000000000000000001"]);
  await db.query(
    "INSERT INTO developer_keys(id,wallet,name,prefix,key_hash) VALUES ($1,$2,$3,$4,$5)",
    ["key-1", "0x0000000000000000000000000000000000000001", "test", apiKey.slice(0, 16), createHash("sha256").update(apiKey).digest("hex")],
  );
  handle = createBoothsApi({ db, workerToken, now: () => new Date(Date.now() + seq++) });
});

describe("experimental Booths job API", () => {
  test("requires an API key and creates an idempotent queued job", async () => {
    expect((await request("/v1/compute/jobs", { method: "POST" })).status).toBe(401);
    const created = await request("/v1/compute/jobs", {
      method: "POST", auth: apiKey, idem: "integration-job-1",
      body: { task: "demo.echo", input: { prompt: "test" } },
    });
    expect(created.status).toBe(202);
    const result = await created.json() as any;
    expect(result).toMatchObject({ task: "demo.echo", status: "queued", experimental: true, idempotent: false });
    jobId = result.id;
    const repeated = await request("/v1/compute/jobs", {
      method: "POST", auth: apiKey, idem: "integration-job-1",
      body: { task: "demo.echo", input: { prompt: "test" } },
    });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ id: jobId, idempotent: true });
    const conflict = await request("/v1/compute/jobs", {
      method: "POST", auth: apiKey, idem: "integration-job-1",
      body: { task: "demo.echo", input: { prompt: "different" } },
    });
    expect(conflict.status).toBe(409);
  });

  test("worker claims once, completes, and customer polls the result", async () => {
    expect((await request("/v1/compute/worker/claim", { method: "POST", auth: "wrong" })).status).toBe(401);
    const claim = await request("/v1/compute/worker/claim", { method: "POST", auth: workerToken });
    const claimed = await claim.json() as any;
    expect(claimed.job).toMatchObject({ id: jobId, task: "demo.echo", input: { prompt: "test" }, attempts: 1 });
    expect((await request("/v1/compute/worker/claim", { method: "POST", auth: workerToken })).status).toBe(200);
    const complete = await request(`/v1/compute/worker/jobs/${jobId}/complete`, {
      method: "POST", auth: workerToken, body: { output: { answer: "hello" } },
    });
    expect(complete.status).toBe(200);
    const status = await request(`/v1/compute/jobs/${jobId}`, { auth: apiKey });
    expect(await status.json()).toMatchObject({ id: jobId, status: "succeeded", output: { answer: "hello" } });
    expect((await request(`/v1/compute/jobs/${jobId}`, { auth: `ctn_live_${"b".repeat(43)}` })).status).toBe(401);
  });

  test("rejects oversized payload shape and malformed task identifiers", async () => {
    const badTask = await request("/v1/compute/jobs", {
      method: "POST", auth: apiKey, idem: `bad-${seq++}`, body: { task: "../shell", input: {} },
    });
    expect(badTask.status).toBe(400);
    const noInput = await request("/v1/compute/jobs", {
      method: "POST", auth: apiKey, idem: `bad-${seq++}`, body: { task: "demo.echo" },
    });
    expect(noInput.status).toBe(400);
  });
});
