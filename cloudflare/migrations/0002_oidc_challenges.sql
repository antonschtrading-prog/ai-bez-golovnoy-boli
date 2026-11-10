-- One-time Telegram OIDC login challenges. Additive and safe for existing D1 data.
-- Never store id tokens, bearer tokens, or private login credentials here.
CREATE TABLE IF NOT EXISTS oidc_challenges (
  nonce TEXT PRIMARY KEY NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oidc_challenges_expires_idx ON oidc_challenges(expires);
