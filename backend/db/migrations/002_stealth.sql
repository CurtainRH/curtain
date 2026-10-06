-- Stealth payouts (ERC-5564, FEATURE_STEALTH_PAYOUTS). The recipient is a one-time stealth
-- address derived in the sender's browser; the operator only stores what it must announce once
-- the payout lands, so the receiver can find it. The announcement is sent by the operator, not
-- the depositor, so nothing on-chain links the depositor to the stealth address.
ALTER TABLE intents
  ADD COLUMN stealth_ephemeral_pub TEXT,           -- 33-byte compressed ephemeral public key
  ADD COLUMN stealth_view_tag      TEXT,           -- 1 byte, announced as metadata
  ADD COLUMN stealth_fee           NUMERIC,        -- gas-drop fee in token_out, paid to the operator
  ADD COLUMN stealth_announce_tx   TEXT,           -- StealthAnnouncer.announce() transaction
  ADD COLUMN stealth_drop_tx       TEXT;           -- ETH gas drop to the stealth address ('skipped' if it already had ETH)

ALTER TABLE intents ADD CONSTRAINT intents_stealth_complete CHECK (
  (stealth_ephemeral_pub IS NULL) = (stealth_view_tag IS NULL) AND
  (stealth_ephemeral_pub IS NULL) = (stealth_fee IS NULL)
);

CREATE INDEX intents_stealth_pending ON intents (status)
  WHERE stealth_ephemeral_pub IS NOT NULL AND (stealth_announce_tx IS NULL OR stealth_drop_tx IS NULL);
