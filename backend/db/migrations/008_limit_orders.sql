-- Limit orders reuse the existing min_out settlement guard. This column lets clients
-- distinguish a market swap from an order that waits for its target price.
ALTER TABLE intents ADD COLUMN order_type TEXT NOT NULL DEFAULT 'market'
  CHECK (order_type IN ('market', 'limit'));
