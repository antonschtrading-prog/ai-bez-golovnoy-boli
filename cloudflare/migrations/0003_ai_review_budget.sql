-- Additive, fail-closed review quotas. No existing lesson, progress or account data is modified.
-- Each date is UTC. Rows count reservations (not successful replies) to avoid unbounded retries.
CREATE TABLE IF NOT EXISTS ai_review_daily_budget (
 day TEXT NOT NULL,
 scope TEXT NOT NULL,
 used INTEGER NOT NULL CHECK(used >= 0),
 PRIMARY KEY(day,scope)
);
