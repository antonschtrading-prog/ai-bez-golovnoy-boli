# Account preview UI — 10 ноября 2026

## Implemented

- `account.html` is a responsive, Russian-language account and sync preparation page, reachable from the existing course navigation.
- The account state clearly says **not configured**; no false claim that cloud login, deployment or automatic sync is active.
- Users can inspect how current local progress compares to a manually selected JSON server snapshot (`{revision,sections}`) **without sending, importing, or overwriting data**.
- The preview validates known section schemas, rejects unsafe nested keys, invalid revisions and oversized files; invalid local records block comparison rather than disappearing.
- The page reports local and server section counts and explicit per-field conflicts. When the merge is safe, it can download a **preview file** containing the proposed combined sections and original server revision; it does not upload them.
- Conflicts disable the combined export to avoid accidental loss. Both source copies remain unchanged.
- `account-preview.js` is a side-effect-free planning/export model; `account-preview-page.js` displays data using `textContent` (never injecting user-authored HTML).

## Tests

- `tests/account-preview.test.cjs`: safe union of independent progress, conflict blocking, corrupted local records, unknown or prototype-pollution fields, oversized cloud snapshot and preservation of server-only sections.
- `tests/browser.cjs`: Chromium mobile viewport verifies conflict UI, clear, safe download and that local progress stays unchanged.

## What is not yet live

- No authentication or real cloud progress is fetched by this page. The selected JSON file is **local-only**; it is suitable for testing the conflict-preflight flow.
- The Telegram SDK is not loaded into the page and no bot/client ID/Cloudflare Worker is configured.
- Account logins, interactive conflict resolution, persistent multi-device sync, auto-save and production backups are upcoming separate work.
- **Do not make the "Upload" action live until server auth, D1 storage, end-to-end Safari/Telegram tests and a data-loss fallback are verified.**
- The previously approved A1–C1 lesson data is unchanged.

## Free-only policy

This feature has no dependencies, paid services or billing operations. GitHub Pages can host it as static files. Preparing a Cloudflare Workers Free + D1 Free service requires a later decision, with no mandatory payment card or trial accepted.
