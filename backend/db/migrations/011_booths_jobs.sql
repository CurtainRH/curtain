CREATE TABLE booths_jobs (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL REFERENCES developer_keys(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  task TEXT NOT NULL,
  input JSONB NOT NULL,
  output JSONB,
  error TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  CHECK (length(task) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX booths_jobs_key_request_unique ON booths_jobs(api_key_id, request_id);
CREATE INDEX booths_jobs_claim_idx ON booths_jobs(status, created_at) WHERE status = 'queued';
CREATE INDEX booths_jobs_key_created_idx ON booths_jobs(api_key_id, created_at DESC);
