-- V3 has a separate operator database. Keep its developer-intent ownership map
-- in that database so idempotency and intent creation remain atomic.
CREATE TABLE developer_v3_intents (
  key_id text NOT NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  intent_id text NOT NULL UNIQUE,
  PRIMARY KEY (key_id, request_id)
);
CREATE INDEX developer_v3_intents_key ON developer_v3_intents(key_id);
