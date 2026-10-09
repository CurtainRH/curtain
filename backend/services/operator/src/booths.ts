import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@curtain/db";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export interface BoothsConfig {
  db: Db;
  /** A separately rotated secret for the experimental runner process. */
  workerToken: string;
  now?: () => Date;
  maxQueuedPerKey?: number;
  leaseSeconds?: number;
  retentionHours?: number;
}

/** Experimental durable compute-job queue. It stores job payloads; it does not execute arbitrary code. */
export function createBoothsApi(cfg: BoothsConfig) {
  const now = cfg.now ?? (() => new Date());
  const leaseSeconds = cfg.leaseSeconds ?? 180;
  const retentionHours = cfg.retentionHours ?? 24;
  let lastCleanup = 0;

  async function cleanupExpiredResults() {
    const current = now().getTime();
    if (current - lastCleanup < 5 * 60_000) return;
    await cfg.db.query(
      "DELETE FROM booths_jobs WHERE status IN ('succeeded','failed') AND finished_at < $1",
      [new Date(current - retentionHours * 60 * 60_000)],
    );
    lastCleanup = current;
  }

  async function readJson(req: Request, limit = 65_536): Promise<Record<string, unknown>> {
    const reader = req.body?.getReader();
    if (!reader) throw new HttpError(400, "JSON body required");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, `Request body exceeds ${limit} bytes`);
      }
      chunks.push(value);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new HttpError(400, "Invalid JSON"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "JSON object required");
    return parsed as Record<string, unknown>;
  }

  async function authenticate(req: Request): Promise<string> {
    const key = req.headers.get("authorization")?.match(/^Bearer (ctn_live_[A-Za-z0-9_-]{43})$/)?.[1];
    if (!key) throw new HttpError(401, "Valid Curtain developer API key required");
    const rows = await cfg.db.query<{ id: string; request_count: number }>(
      `UPDATE developer_keys SET last_used_at = now(), window_start = $2,
       request_count = CASE WHEN window_start = $2 THEN request_count + 1 ELSE 1 END
       WHERE key_hash = $1 AND revoked_at IS NULL RETURNING id, request_count`,
      [sha256(key), Math.floor(now().getTime() / 60_000)],
    );
    if (!rows[0]) throw new HttpError(401, "Invalid or revoked API key");
    if (rows[0].request_count > 60) throw new HttpError(429, "API key limit: 60 requests per minute");
    return rows[0].id;
  }

  function authenticateWorker(req: Request) {
    const provided = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const a = Buffer.from(provided);
    const b = Buffer.from(cfg.workerToken);
    if (!cfg.workerToken || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "Worker authentication required");
  }

  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (!path.startsWith("/v1/compute/")) return null;
    try {
      if (req.method === "OPTIONS") return new Response(null, {
        status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, idempotency-key" },
      });

      if (path === "/v1/compute/jobs" && req.method === "POST") {
        const keyId = await authenticate(req);
        await cleanupExpiredResults();
        const body = await readJson(req);
        if (typeof body.task !== "string" || !/^[a-z][a-z0-9._-]{0,79}$/.test(body.task)) throw new HttpError(400, "task must be a 1–80 character task identifier");
        if (body.input === undefined || body.input === null || typeof body.input !== "object") throw new HttpError(400, "input must be a JSON object or array");
        const requestId = req.headers.get("idempotency-key") ?? "";
        if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId)) throw new HttpError(400, "Idempotency-Key header required (1–128 letters, numbers, _, ., :, -)");
        const input = JSON.stringify(body.input);
        if (Buffer.byteLength(input) > 48_000) throw new HttpError(413, "input exceeds 48 KB");
        const requestHash = sha256(JSON.stringify({ task: body.task, input: body.input }));
        return await cfg.db.transaction(async (tx) => {
          // Serialize idempotency and queue-limit checks for submissions using this key.
          const activeKey = await tx.query("SELECT id FROM developer_keys WHERE id=$1 AND revoked_at IS NULL FOR UPDATE", [keyId]);
          if (!activeKey[0]) throw new HttpError(401, "API key revoked");
          const existing = await tx.query<{ id: string; task: string; status: string }>(
            "SELECT id, task, status FROM booths_jobs WHERE api_key_id = $1 AND request_id = $2",
            [keyId, requestId],
          );
          if (existing[0]) {
            const full = await tx.query<{ request_hash: string }>("SELECT request_hash FROM booths_jobs WHERE id = $1", [existing[0].id]);
            if (full[0]?.request_hash !== requestHash) throw new HttpError(409, "Idempotency-Key was already used with different input");
            return json({ ...existing[0], idempotent: true });
          }
          const count = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM booths_jobs WHERE api_key_id = $1 AND status IN ('queued','running')", [keyId]);
          if (Number(count[0]?.count ?? 0) >= (cfg.maxQueuedPerKey ?? 20)) throw new HttpError(429, "Maximum active compute jobs reached");
          const id = randomBytes(16).toString("hex");
          const rows = await tx.query<{ id: string; task: string; status: string; created_at: Date }>(
            "INSERT INTO booths_jobs(id, api_key_id, request_id, request_hash, task, input) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id, task, status, created_at",
            [id, keyId, requestId, requestHash, body.task, input],
          );
          return json({ ...rows[0], idempotent: false, experimental: true }, 202);
        });
      }

      const jobId = path.match(/^\/v1\/compute\/jobs\/([a-f0-9]{32})$/)?.[1];
      if (jobId && req.method === "GET") {
        const keyId = await authenticate(req);
        await cleanupExpiredResults();
        const rows = await cfg.db.query(
          `SELECT id, task, status, output, error, attempts, created_at AS "createdAt", started_at AS "startedAt", finished_at AS "finishedAt"
           FROM booths_jobs WHERE id = $1 AND api_key_id = $2
             AND (status IN ('queued','running') OR finished_at >= $3)`,
          [jobId, keyId, new Date(now().getTime() - retentionHours * 60 * 60_000)],
        );
        if (!rows[0]) throw new HttpError(404, "Compute job not found");
        return json({ ...rows[0], experimental: true });
      }

      const heartbeatId = path.match(/^\/v1\/compute\/worker\/jobs\/([a-f0-9]{32})\/heartbeat$/)?.[1];
      if (heartbeatId && req.method === "POST") {
        authenticateWorker(req);
        const leaseUntil = new Date(now().getTime() + leaseSeconds * 1000);
        const rows = await cfg.db.query(
          "UPDATE booths_jobs SET lease_until=$2 WHERE id=$1 AND status='running' RETURNING id",
          [heartbeatId, leaseUntil],
        );
        if (!rows[0]) throw new HttpError(409, "Job is not currently leased");
        return json({ id: heartbeatId, leaseUntil, leaseSeconds });
      }

      if (path === "/v1/compute/worker/claim" && req.method === "POST") {
        authenticateWorker(req);
        return await cfg.db.transaction(async (tx) => {
          // Requeue timed-out leases, then atomically claim one item across concurrent workers.
          const expiredAt = now();
          await tx.query(
            `UPDATE booths_jobs SET
               status=CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
               error=CASE WHEN attempts >= 3 THEN 'Worker lease expired too many times' ELSE error END,
               finished_at=CASE WHEN attempts >= 3 THEN $1 ELSE finished_at END,
               lease_until=NULL
             WHERE status='running' AND lease_until < $1`,
            [expiredAt],
          );
          const rows = await tx.query<{ id: string; task: string; input: unknown; attempts: number }>(
            `WITH candidate AS (
               SELECT id FROM booths_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
             )
             UPDATE booths_jobs j SET status='running', attempts=j.attempts+1, started_at=$1, lease_until=$2
             FROM candidate c WHERE j.id=c.id RETURNING j.id, j.task, j.input, j.attempts`,
            [now(), new Date(now().getTime() + leaseSeconds * 1000)],
          );
          return json({ job: rows[0] ?? null, leaseSeconds });
        });
      }

      const finish = path.match(/^\/v1\/compute\/worker\/jobs\/([a-f0-9]{32})\/(complete|fail)$/)?.[1];
      const finishAction = path.match(/^\/v1\/compute\/worker\/jobs\/[a-f0-9]{32}\/(complete|fail)$/)?.[1];
      if (finish && finishAction && req.method === "POST") {
        authenticateWorker(req);
        const body = await readJson(req);
        const terminalAt = now();
        if (finishAction === "complete") {
          if (body.output === undefined) throw new HttpError(400, "output is required");
          const encoded = JSON.stringify(body.output);
          if (Buffer.byteLength(encoded) > 48_000) throw new HttpError(413, "output exceeds 48 KB");
          const rows = await cfg.db.query("UPDATE booths_jobs SET status='succeeded', output=$2::jsonb, finished_at=$3, lease_until=NULL WHERE id=$1 AND status='running' RETURNING id", [finish, encoded, terminalAt]);
          if (!rows[0]) throw new HttpError(409, "Job is not currently leased");
          return json({ id: finish, status: "succeeded" });
        }
        const message = typeof body.error === "string" ? body.error.slice(0, 500) : "Worker failed to execute job";
        const rows = await cfg.db.query("UPDATE booths_jobs SET status='failed', error=$2, finished_at=$3, lease_until=NULL WHERE id=$1 AND status='running' RETURNING id", [finish, message, terminalAt]);
        if (!rows[0]) throw new HttpError(409, "Job is not currently leased");
        return json({ id: finish, status: "failed" });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof SyntaxError) return json({ error: "Invalid JSON" }, 400);
      // Job payloads and worker errors can contain user data; never log them.
      return json({ error: "Compute API temporarily unavailable" }, 503);
    }
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
