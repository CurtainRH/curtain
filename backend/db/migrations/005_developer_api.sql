CREATE TABLE developer_wallets (
  wallet text PRIMARY KEY
);
CREATE TABLE developer_challenges (
  id text PRIMARY KEY,
  wallet text NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX developer_challenges_wallet_created ON developer_challenges(wallet, created_at);
CREATE INDEX developer_challenges_expiry ON developer_challenges(expires_at);
CREATE TABLE developer_keys (
  id text PRIMARY KEY,
  wallet text NOT NULL REFERENCES developer_wallets(wallet),
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  window_start bigint NOT NULL DEFAULT 0,
  request_count integer NOT NULL DEFAULT 0
);
CREATE INDEX developer_keys_wallet ON developer_keys(wallet);
CREATE TABLE developer_intents (
  key_id text NOT NULL REFERENCES developer_keys(id),
  request_id text NOT NULL,
  request_hash text NOT NULL,
  intent_id text NOT NULL UNIQUE REFERENCES intents(id),
  PRIMARY KEY (key_id, request_id)
);
