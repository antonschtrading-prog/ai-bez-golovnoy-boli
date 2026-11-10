-- Index for automatic expiry cleanup during authenticated Telegram logins.
CREATE INDEX IF NOT EXISTS replays_expires_idx ON replays(expires);
