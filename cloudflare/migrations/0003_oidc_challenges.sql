-- One-time browser login challenges; expiry enforced server-side.
CREATE TABLE IF NOT EXISTS oidc_challenges (
 nonce TEXT PRIMARY KEY NOT NULL,
 expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oidc_challenges_expiry ON oidc_challenges(expires);
