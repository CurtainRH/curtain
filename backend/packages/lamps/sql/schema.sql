CREATE TABLE IF NOT EXISTS lamps_offers (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lamps_reservations (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES lamps_offers(id),
  buyer_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, request_id)
);

CREATE INDEX IF NOT EXISTS lamps_reservations_by_offer ON lamps_reservations (offer_id, status);
