-- Keep Merkle state isolated when a Pool V2 deployment is replaced. Existing rows belong to
-- the original mainnet pool; future deployments receive their own notes and event cursor.
ALTER TABLE pool_v4_notes
  ADD COLUMN pool_address TEXT NOT NULL DEFAULT '0x38147c547cde831812cd075166e279b77ff164cc';
ALTER TABLE pool_v4_notes DROP CONSTRAINT pool_v4_notes_pkey;
ALTER TABLE pool_v4_notes ADD PRIMARY KEY (pool_address, commitment);
DROP INDEX IF EXISTS pool_v4_notes_order;
CREATE INDEX pool_v4_notes_order ON pool_v4_notes(pool_address, block, log_index);

ALTER TABLE pool_v4_cursor
  ADD COLUMN pool_address TEXT NOT NULL DEFAULT '0x38147c547cde831812cd075166e279b77ff164cc';
ALTER TABLE pool_v4_cursor DROP CONSTRAINT pool_v4_cursor_pkey;
ALTER TABLE pool_v4_cursor ADD PRIMARY KEY (pool_address);

-- The previous indexer could advance this cursor while silently skipping undecoded events.
-- Rewind the legacy pool once so the corrected decoder can recover its old notes. Subsequent
-- empty-pool syncs must honor the persisted cursor rather than rescanning the whole history.
UPDATE pool_v4_cursor
SET block = 84199145
WHERE pool_address = '0x38147c547cde831812cd075166e279b77ff164cc';
