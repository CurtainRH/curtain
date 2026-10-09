-- Pool V2 notes for the product-level V4 route. Commitments are public; note secrets never enter
-- this table. The ordered commitment list is enough to rebuild the fixed-depth Poseidon tree.
CREATE TABLE pool_v4_notes (
  commitment TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  block BIGINT NOT NULL,
  log_index INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pool_v4_notes_order ON pool_v4_notes(block, log_index);

CREATE TABLE pool_v4_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  block BIGINT NOT NULL
);
