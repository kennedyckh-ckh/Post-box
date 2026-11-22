# Delivery notes

## 1. What is delivered
A complete new application (nothing was carried over from earlier prototypes). All source is in this folder; `git log` shows it was built in six phases:
Foundations → Stages and workspace → Submission and session management → Sharing, reactions, peer responses, projector, export → Optional AI and usage page → Hardening and delivery.

Changed or created files (all are new): run `git ls-files` for the exact list (about 110 files, roughly 11,000 lines including tests and docs). Where things are:

| Folder | Contents |
|---|---|
| `app/` | Pages: home, join, recover, participant session / workspace / class board, facilitator dashboard / session screens / administration / AI usage, projector (`present/[token]`), notice; and the single API entry point `app/api/[...path]/route.ts` |
| `components/` | Shared interface pieces (`ui.tsx`), participant workspace pieces, facilitator tabs |
| `lib/` | Database and migrations, sign-in and guards, throttling, stage rules, submissions, sharing, files, housekeeping; `handlers/` has every endpoint; `ai/` has the AI layer |
| `tests/` | The 120 automated tests |
| `scripts/` | Build, backup, restore, schema and route listing helpers, and the join-race helper used by a test |
| `docs/` | This documentation |
| `render.yaml`, `.env.example` | Deployment settings (placeholders only) |

## 2. Final database schema and permission matrix
- Schema: `docs/SCHEMA.sql` (28 tables, generated from the real migrations). Tables are grouped in `lib/migrations.ts` by phase (001 foundations, 002 workspace, 003 submission, 004 sharing, 005 AI).
- Permission matrix: `docs/PERMISSIONS.md`. All endpoints: `docs/ROUTES.txt`.
- Workflow states: `docs/WORKFLOWS.md`.

## 3. Environment variables (names exactly; values go only in the host's settings)

| Name | Needed | Purpose |
|---|---|---|
| `DATA_DIR` | on a host | Folder that holds the database and uploads (on Render: the disk's mount path, `/var/data`) |
| `COOKIE_SECURE` | on a host | `1` makes sign-in cookies HTTPS-only and turns on HSTS (set before building) |
| `TRUST_PROXY` | behind a proxy | `1` so the app sees each visitor's address (needed for fair throttling) |
| `PUBLIC_HOST` | only if sign-in says “Cross-site request blocked” | Your public host name |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` | first start only | Creates the first administrator when there are no accounts; delete afterwards |
| `AI_PROVIDER` | optional | `simulated` (default) or `hku` |
| `HKU_API_KEY` | for `hku` | **Secret.** Sent in the `api-key` header; entered only in Render |
| `HKU_API_ENDPOINT` | for `hku` | The **complete** request URL from the HKU portal, used exactly as given |
| `HKU_API_VERSION` | optional | Added as `api-version` only if set and not already in the endpoint |
| `AI_MODEL` | optional | Model label, default `gpt-4.1-nano` |
| `AI_SEND_MODEL` | optional | `1` to also put the model name in the request body |
| `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_RETRY_DELAY_MS` | optional | Timeout, retries (at most 3) and delay for temporary failures |
| `AI_MAX_INPUT_CHARS` | optional | Longest selection sent in one request (default 60,000); longer is refused, never cut |
| `AI_LIMIT_REQUESTS_PER_DAY`, `AI_LIMIT_TOKENS_PER_MONTH` | optional | Default per-facilitator limits (an administrator can override them in the app) |

These names are the proposed ones from the brief. There was no earlier AI configuration to map them to. The setting `HKU_API_ENDPOINT` is defined as a **complete request URL** (not a base URL), so nothing is appended twice. If the gateway needs a deployment identifier different from the model label, put it in the endpoint URL as the portal shows it (that is where Azure-style gateways carry it).

## 4. Render configuration (no secrets)
See `render.yaml` and `docs/DEPLOY-RENDER.md`. In short: one web service, Node 22, build `npm ci --include=dev && npm run build`, start `npm start`, health check `/api/health`, a persistent disk mounted at `/var/data`, `DATA_DIR=/var/data`, `COOKIE_SECURE=1`, `TRUST_PROXY=1`, the three `BOOTSTRAP_ADMIN_*` values for the first start, and the AI settings if and when you want them.

## 5. Dependencies and why

| Package | Why |
|---|---|
| `next`, `react`, `react-dom` | The web framework and interface |
| `better-sqlite3` | The database (one file, no separate server). Installs as a ready-made binary on Node 22 |
| `typescript`, `@types/*` | Type checking |
| `tailwindcss`, `@tailwindcss/postcss` | Styling |
| `eslint`, `eslint-config-next`, `@eslint/eslintrc` | Code checks |
| `vitest` | The automated tests |
| `tsx` | Runs the TypeScript helper scripts (backup, restore, schema, routes, the join race) and is needed on the host for `npm run backup` |

There are no other runtime dependencies: no email service, no analytics, no third-party scripts or fonts (system fonts include Traditional Chinese). `package-lock.json` pins every version; the host installs with `npm ci`.

## 6. Persistence, backup and restoration
- **Database:** `DATA_DIR/app.db` (SQLite, WAL mode). **Attachments:** `DATA_DIR/uploads/` (random names). Both must be on the persistent disk.
- **Backup:** `npm run backup` (safe while running; checks the copy). **Restore:** `npm run restore -- <backup folder>`; the replaced data is kept aside. Details and the warning about restarting straight after a restore are in `docs/DEPLOY-RENDER.md` section 6. Both were tested (including restoring into an empty folder and refusing a damaged backup).
- **Migrations** copy the database to `DATA_DIR/backups/` before changing an existing database.
- **Deletion and backups:** deleting a session never deletes earlier backups.

## 7. Outstanding decisions for you
1. Whether the retention wording (“until the facilitator deletes the session”) matches your organisation's rules, and whether your institution needs its own notice on top of `/notice`.
2. Whether HKU permits sending participants' written work (without names) to the gateway. The app sends nothing unless a facilitator turns it on and presses Generate.
3. The default AI limits (100 live requests per day and 500,000 tokens per month per facilitator) are placeholders; set values that fit your quota.
4. How often to take backups, and who holds them (the app does not schedule them).
5. The choices listed under “Decisions taken where the brief left a choice” in the README.
