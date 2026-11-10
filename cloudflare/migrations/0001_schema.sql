-- Cloudflare D1 (SQLite): prepare with wrangler d1 migrations apply.
-- No destructive migrations; existing Node SQLite service remains unchanged.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY NOT NULL,
  account TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires);
CREATE TABLE IF NOT EXISTS progress (
  account TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  sections TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  account TEXT NOT NULL,
  revision INTEGER NOT NULL,
  sections TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY(account,revision)
);
CREATE TABLE IF NOT EXISTS operations (
  account TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  response TEXT NOT NULL,
  PRIMARY KEY(account,id)
);
CREATE TABLE IF NOT EXISTS telegram (
  user TEXT PRIMARY KEY NOT NULL,
  account TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS replays (
  hash TEXT PRIMARY KEY NOT NULL,
  expires INTEGER NOT NULL
);
