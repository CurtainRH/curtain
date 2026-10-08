-- Ticket sync (FEATURE_TICKET_SYNC): escape tickets encrypted in the browser with a key derived
-- from a wallet signature. Rows are keyed by an id derived from that same signature, never by
-- wallet address, so the operator can neither read a backup nor tell whose it is. Writes need
-- the derived auth secret, whose hash is pinned by the first write.
CREATE TABLE ticket_sync (
  id          TEXT PRIMARY KEY,                -- 0x + 32 bytes, derived from the signature
  auth_hash   TEXT NOT NULL,                   -- keccak256(auth secret), set on first write
  blob        TEXT NOT NULL,                   -- 0x + AES-256-GCM(iv || ciphertext), opaque here
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
