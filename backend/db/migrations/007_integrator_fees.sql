-- Optional Developer API integrator fee. It is a separate signed payout,
-- deducted from the user's output.
ALTER TABLE intents ADD COLUMN integrator_fee_recipient TEXT;
ALTER TABLE intents ADD COLUMN integrator_fee_bps INTEGER NOT NULL DEFAULT 0
  CHECK (integrator_fee_bps >= 0 AND integrator_fee_bps <= 100);
