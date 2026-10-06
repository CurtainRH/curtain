-- Split payouts (FEATURE_SPLIT_PAYOUTS): one swap paid to 2-5 recipients, in random or equal
-- shares. intents.recipient keeps the first recipient; every recipient (including the first)
-- is a row here. Stealth split recipients carry their own announcement data and follow-up.
CREATE TABLE intent_splits (
  intent_id             TEXT NOT NULL REFERENCES intents(id),
  position              INTEGER NOT NULL CHECK (position >= 0 AND position < 5),
  recipient             TEXT NOT NULL,
  share_bps             INTEGER NOT NULL CHECK (share_bps > 0 AND share_bps <= 10000),
  stealth_ephemeral_pub TEXT,
  stealth_view_tag      TEXT,
  stealth_fee           NUMERIC,
  stealth_announce_tx   TEXT,
  stealth_drop_tx       TEXT,
  PRIMARY KEY (intent_id, position),
  CONSTRAINT intent_splits_stealth_complete CHECK (
    (stealth_ephemeral_pub IS NULL) = (stealth_view_tag IS NULL) AND
    (stealth_ephemeral_pub IS NULL) = (stealth_fee IS NULL)
  )
);

CREATE INDEX intent_splits_stealth_pending ON intent_splits (intent_id)
  WHERE stealth_ephemeral_pub IS NOT NULL AND (stealth_announce_tx IS NULL OR stealth_drop_tx IS NULL);
