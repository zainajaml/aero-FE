# Migration audit and overview report: aero-zenith-flow (Space Scope)

Status: **complete for the agreed scope.** Two items wait on credentials or a provider choice: Google sign-in and the email bounce webhook.
Date: 2026-10-02. Scope: leave Supabase and Lovable entirely, with a fresh start (schema only; no rows, users or files imported). No provider is retained.
Project profile:

- **Origin:** Lovable (TanStack Start) app on Lovable Cloud Supabase.
- **Supabase features used:** Postgres with about 110 RLS policies, Auth (email and Google), Storage (4 buckets), Realtime, pgmq email queue, and Lovable email and AI gateways.
- **Extras:** MCP server with OAuth.
- **Tenancy:** multi-tenant (accounts → projects), with 6 roles.

## Overview

Space Scope is a sprint and delivery tool: backlog, board, gantt, tickets with comments, work logs, estimates and attachments, documents, reporting with AI summaries, billing, support desk, Jira import, and MCP tools for AI clients.

It now consists of two independent repositories:

- **Frontend:** React 19 + Vite + TanStack Router/Query. It holds no business logic and calls a typed client generated from OpenAPI.
- **Backend:** Express 5 + Zod + Drizzle + Better Auth on PostgreSQL 17, with S3-compatible private storage and SMTP email.

Supabase RLS is replaced by explicit backend policies, tested for every operation. All 146 API operations have passing success and failure tests on a database built from migrations. Eleven browser journeys pass against the real stack.

The code is ready for a staging rehearsal and cutover. Production cutover still needs the provider decisions listed at the end.

## Coverage at a glance

| Area                                 | Total | Done/verified                                    | Blocked                          | Retired / not applicable                       |
| ------------------------------------ | ----- | ------------------------------------------------ | -------------------------------- | ---------------------------------------------- |
| Workflows (ledger F/W/D rows)        | 31    | 29                                               | 1 (W-02 Google: credentials)     | 0; W-22 bounces deferred (provider)            |
| Source server routes (ledger R rows) | 8     | 6                                                | 1 (R-05 bounce events: provider) | 1 (R-01 unused attachment proxy)               |
| API operations (success + failure)   | 146   | 146 / 146                                        | 0                                | 0 N.A. entries                                 |
| Schema objects (schema-coverage.md)  | 58    | 52 recreated/replaced + 2 added (MCP OAuth, SSE) | 0                                | 4 retired with reasons (pgcrypto, pgmq, view…) |
| RLS policies → backend policies      | ~110  | all, enforced in services                        | 0                                | —                                              |
| Integrations / functions / jobs      | 9     | 8                                                | 1 (bounce webhook)               | —                                              |
| Data rows / users / files reconciled | —     | —                                                | —                                | NOT APPLICABLE: fresh start agreed             |

The RLS row is verified by denied-actor tests in each module, and by the acceptance sweep, which checks 401s and 400 path-parameter validation across every operation.

The integrations are SMTP email, S3 storage, Gemini AI, the billing API, Jira OAuth plus import, the MCP OAuth server, the SSE access feed, the hourly purge, and email bounces.

## Gate results

| Gate                                    | Result       | Evidence                                                                   |
| --------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| 1 Discover                              | PASS         | discovery.md                                                               |
| 2 Stack and scope confirmed             | PASS         | React + Express, fresh start (plan.md)                                     |
| 3 Architecture and plan                 | PASS         | architecture.md, plan.md, ledger.md                                        |
| 4 Foundations (separate repos)          | PASS         | two repos, each with its own lockfile, CI and Dockerfile                   |
| 5 Vertical features                     | PASS (scope) | ledger.md: 29 verified, 1 blocked on credentials, bounces deferred         |
| 6 Deployment rehearsal                  | PASS         | `npm run smoke:prod`; both images build; backend container reports healthy |
| 7 Verification gates                    | PASS         | verification.md; the checks table below                                    |
| 8 Runtime API acceptance on isolated DB | PASS         | api-coverage.md: 146/146; Playwright 11/11, two runs in a row              |
| 9 Final report                          | PASS         | this file                                                                  |

## Architecture

| Repo     | Path                                             | Framework / runtime                                                        | Package manager               |
| -------- | ------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------- |
| Backend  | `/home/zain-ajmal/www/aero-zenith-flow-backend`  | Node 24, Express 5, Zod 4, Drizzle 0.45 + drizzle-kit, Better Auth 1.7, pg | npm (lockfile from npm 11.19) |
| Frontend | `/home/zain-ajmal/www/aero-zenith-flow-frontend` | React 19, Vite 7, TanStack Router + Query, openapi-fetch, Tailwind         | npm (lockfile from npm 11.19) |

Both repositories are local only: they have no git remotes, and nothing was pushed.

**Backend `src/`**

- `config/` validates the environment with Zod; the server refuses to start on missing or weak secrets.
- `database/` holds the schema (one file per table), 51 ordered migrations and the migrator (advisory lock).
- `shared/` holds the HTTP pieces:
  - `defineRoute`, which builds both the routes and OpenAPI;
  - the response envelope and the central error handler;
  - CSRF origin check, rate limits and logging.
- `integrations/` covers email, storage, AI, billing and Atlassian.
- `modules/` has 25 feature modules: access, accounts, admin, audit, auth, billing, board, comments, documents, epics, files, health, invitations, jira, maintenance, mcp, notifications, onboarding, projects, reporting, sprints, support, tickets, users and worklogs. Each splits into routes → service → repository.

**Frontend `src/`**

- `app/` is the shell.
- `routes/` holds thin file routes.
- `shared/` holds the API client and interceptors, generated types and UI primitives.
- `features/` holds 23 features: accounts, admin, audit, auth, backlog, billing, board, documents, gantt, invitations, jira, marketing, notifications, oauth, onboarding, profile, projects, reporting, rich-text, support, tickets, users and workspace. Each splits into api, hooks, components and views.

**API contract:** `openapi/openapi.json` is committed in the backend and generated from the route definitions. Swagger is served at `/api/docs` outside production.

To update the frontend client, run `npm run api:sync` in the frontend. It copies the spec and regenerates `src/shared/api/schema.gen.ts`. CI in both repos fails if either file drifts.

## Data, identity and files

| Workstream    | Source/export used                                            | Result                                                                                            | Status         |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------- |
| Schema        | Supabase + Drizzle migration history (archived in `history/`) | Recreated as 51 focused drizzle-kit migrations                                                    | PASS           |
| Rows          | —                                                             | Fresh start by user decision                                                                      | NOT APPLICABLE |
| Identities    | —                                                             | Fresh start; users sign up or are re-invited (`bootstrap-super-admin.ts` creates the first admin) | NOT APPLICABLE |
| Storage files | —                                                             | Fresh start                                                                                       | NOT APPLICABLE |

## Authorization

The source RLS helper functions are ported to `modules/access/access.policy.ts`, and services check them on every read, write, upload, download, SSE channel and MCP tool. These rules, previously enforced by triggers or only in the UI, now apply to every writer:

- Archived projects are read-only (database triggers 0044, error `PROJECT_ARCHIVED`).
- Account admins cannot also hold project seats (0043).
- The last account admin of an account can't be removed.
- Tickets in a completed sprint are locked.
- Only managers can edit estimates.

Tests cover anonymous, archived, viewer, developer, project admin, other-account admin, account admin and super admin actors (see ledger.md). Differences from the source are deliberate and listed in plan.md. Examples:

- Invitations apply only after the email is verified.
- Tokens are stored as hashes.
- The `document-images` bucket is now private.

## Integrations and retained providers

| Integration              | Replacement                                                                                                                      | Verified with                                   | Status                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------- |
| Supabase Auth (+ Google) | Better Auth (email verification, reset, change, Google provider), cookie prefix `azf`                                            | auth-and-access.test.ts, smoke-prod, Playwright | PASS; Google BLOCKED (credentials) |
| Supabase Storage         | S3-compatible private bucket, signed URLs, MIME type checked from the file contents                                              | files/documents/support tests                   | PASS                               |
| Supabase Realtime        | SSE `/me/access-events` from Postgres LISTEN/NOTIFY                                                                              | access-events.test.ts                           | PASS                               |
| pgmq + Lovable email     | Synchronous SMTP send with bounded retry, logged with HTML; React Email templates; RFC 8058 unsubscribe                          | notifications.test.ts, Playwright (Mailpit)     | PASS                               |
| Email bounce events      | Needs the chosen provider's webhook                                                                                              | —                                               | BLOCKED (provider)                 |
| Lovable AI gateway       | `@ai-sdk/google`, model `AI_SUMMARY_MODEL`                                                                                       | reporting/external-services tests (fake model)  | PASS (needs key in prod)           |
| Billing API              | Server-side proxy client                                                                                                         | billing.test.ts (fake upstream)                 | PASS (needs creds)                 |
| Jira OAuth + import      | `jira` module; tokens encrypted with AES-256-GCM; client-driven import steps                                                     | jira.test.ts (fake Atlassian)                   | PASS (needs app)                   |
| Lovable MCP + OAuth      | `POST /mcp` (2026-07-28 protocol plus stateless 2025-era clients) and the Better Auth OAuth 2.1 server (DCR, PKCE, consent page) | mcp.test.ts; consent flow in a browser          | PASS                               |
| Opportunistic purges     | Hourly in-process purge of expired rate-limit, verification and OAuth rows                                                       | maintenance.test.ts                             | PASS                               |

## Environment variables (names only)

**Backend.** Required unless marked optional:

- **Runtime:** `NODE_ENV`, `PORT`, `LOG_LEVEL`, `TRUST_PROXY`.
- **Database:** `DATABASE_URL`, `DATABASE_POOL_MAX`.
- **URLs:** `APP_URL`, `API_URL`, `CORS_ORIGINS` (optional).
- **Auth:**
  - `AUTH_SECRET` (secret, ≥ 32 characters).
  - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (secret; optional, set both or neither).
  - `SUPER_ADMIN_EMAIL_DOMAIN`.
- **Email:** `SMTP_URL` (secret), `EMAIL_FROM`.
- **Storage:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` (secret), `S3_SECRET_ACCESS_KEY` (secret), `S3_FORCE_PATH_STYLE`, `FILE_URL_TTL_SECONDS`.
- **Billing (optional):** `BILLING_API_URL`, `BILLING_API_KEY` (secret), `BILLING_TENANT_ID`.
- **Jira (optional; set all four or none):** `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET` (secret), `JIRA_REDIRECT_URI`, `JIRA_TOKEN_ENCRYPTION_KEY` (secret).
- **AI (optional):** `GOOGLE_GENERATIVE_AI_API_KEY` (secret), `AI_SUMMARY_MODEL`.

**Frontend:**

- `VITE_API_URL` is public and set at build time; leave it empty for same-origin.
- `DEV_API_PROXY_TARGET` is used by the dev server only.
- `API_UPSTREAM` is the nginx runtime setting, defaulting to `http://api:4000`.

## Checks

| Check                                    | Command                                                     | Result                                                                        |
| ---------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Backend typecheck / lint / format        | `npm run typecheck && npm run lint && npm run format:check` | PASS                                                                          |
| Backend cycles / unused                  | `npm run deps:cycles && npx knip`                           | PASS (no cycles, knip clean)                                                  |
| Backend schema drift                     | `npm run db:check`                                          | PASS                                                                          |
| Backend tests + API coverage             | `npm run test:api-coverage`                                 | PASS: 26 files, 400 tests; 146/146 operations covered for success and failure |
| Production smoke                         | `npm run smoke:prod`                                        | PASS (verification.md has the output)                                         |
| Startup refuses bad config               | server started without `AUTH_SECRET`, then with a short one | PASS (exits 1 with a named error)                                             |
| Backend image + healthcheck              | `docker build .` and run                                    | PASS (healthy via `/health/ready`)                                            |
| Frontend typecheck / lint / format       | `npm run typecheck && npm run lint && npm run format:check` | PASS                                                                          |
| Frontend cycles / unused / unit tests    | `npm run deps:cycles && npx knip && npm test`               | PASS (15 unit tests)                                                          |
| Frontend build + image                   | `npm run build`, `docker build .`                           | PASS (SPA fallback; no public source maps)                                    |
| Browser journeys (isolated DB `azf_e2e`) | `E2E_BASE_URL=… MAILPIT_URL=… npx playwright test`          | PASS: 11/11, two runs in a row                                                |

The browser journeys cover:

- sign-up, verify and onboard;
- sign-in, including a wrong password;
- route guard;
- tickets: create, edit, comment, log time, deep link;
- sprint and board: plan, start, drag a card;
- team: invite, then a viewer's read-only view;
- documents;
- support;
- notifications, including invitations;
- profile and preferences.

## Defects found by verification and fixed

| Found by           | Defect                                                                                                      | Fix commit (repo)    |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------- |
| Playwright         | Invitations never listed under their project: `project_ids` was never logged, and the filter ignored arrays | `873923d` (backend)  |
| Playwright         | Viewers were told a ticket was in a completed sprint                                                        | `b9728e9` (frontend) |
| Playwright         | Many form controls had no accessible name; the support widget lacked dialog semantics                       | `b41d17f` (frontend) |
| Playwright         | The notifications log briefly showed unfiltered rows before the project loaded                              | `4bf21fa` (frontend) |
| Ticket dialog port | Bulk edit that only adds epics was rejected; estimate dates on create were dropped                          | `91270a5` (backend)  |
| Docker run         | Healthcheck pointed at a missing route                                                                      | `44e5038` (backend)  |
| Docs review        | Nothing purged expired rate-limit, verification or OAuth rows                                               | `6dc85f9` (backend)  |

## Remaining references

| Location                                                                                                       | Classification      | Action |
| -------------------------------------------------------------------------------------------------------------- | ------------------- | ------ |
| `docs/migration/history/` (source migrations)                                                                  | historical evidence | keep   |
| 2 code comments ("replaces Supabase …")                                                                        | historical note     | keep   |
| No Supabase or Lovable SDKs, URLs, variables, `auth.uid()`, Deno code, or a service-role client in either repo | —                   | none   |

## Cleanup performed

| Repo     | Removed                                                                                                                                                                 | Reason                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Backend  | `cookie-parser`, `@types/cookie-parser`, `pg-boss`                                                                                                                      | unused (knip)                    |
| Backend  | `scripts/build-migrations.sh`, empty `src/modules/auth/tests`, 5 dead symbols, 27 exports made module-private                                                           | one-off scaffold, dead code      |
| Frontend | 30 unused files (26 unused shadcn components, `use-mobile`, `email-normalize`, `invite-expiry`, `tickets/index.ts`)                                                     | unused (knip, confirmed by grep) |
| Frontend | 20 dependencies (14 Radix packages, dnd-kit sortable/utilities, embla, input-otp, react-resizable-panels, vaul) and 5 dev dependencies (testing-library ×3, msw, jsdom) | unused                           |
| Frontend | About 80 unused exports and 36 types; `docs/porting-guide.md`; `scripts/port-imports.sh`; build output folders                                                          | porting leftovers and dead code  |
| Both     | All temporary worktrees and branches                                                                                                                                    | only the two repos remain        |

## Security audit

| Check                                                  | Result | Notes                                                                                                        |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------ |
| No database credentials or service keys in the browser | PASS   | The frontend only knows its API origin                                                                       |
| Session cookies                                        | PASS   | HttpOnly, Secure, `__Secure-` prefix in production (smoke-prod)                                              |
| CSRF                                                   | PASS   | Origin allowlist on state-changing `/api/v1` and auth calls; tested                                          |
| Secrets validated at startup, none hard-coded          | PASS   | Zod env; startup fails without them                                                                          |
| Tokens at rest                                         | PASS   | Invitation and unsubscribe tokens hashed; Jira tokens AES-256-GCM                                            |
| Files                                                  | PASS   | Private bucket, policy check before signing, MIME type checked from the file contents                        |
| Rate limits                                            | PASS   | Durable Postgres limiter for auth, OAuth registration/token, MCP tools and AI                                |
| MCP OAuth                                              | PASS   | PKCE S256, consent required, audience/issuer/expiry/DPoP checks, HTTPS redirect URIs                         |
| Production surface                                     | PASS   | Swagger and the OpenAPI document are off in production; helmet headers; no public source maps                |
| Known exposure                                         | NOTE   | Better Auth returns the session token in the sign-in JSON body (library behavior); the cookie stays HttpOnly |

## Remaining risks and next actions

| Item                                         | Owner      | Exact action                                                                                                            |
| -------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Hosting target                               | user       | Choose a host; run both images and `migrate` per cutover.md                                                             |
| Email provider + domain authentication       | user       | Provide `SMTP_URL`; set up SPF, DKIM and DMARC; then implement the bounce webhook (R-05) for that provider              |
| Google sign-in                               | user       | Create the OAuth client; set `GOOGLE_CLIENT_ID/SECRET`; run the Google journey manually once                            |
| Gemini, billing, Jira credentials            | user       | Provide the keys, or leave those features off (they show a "not configured" state)                                      |
| MCP signing keys depend on `AUTH_SECRET`     | user       | Never rotate `AUTH_SECRET` casually: rotating it invalidates sessions and MCP tokens                                    |
| OAuth refresh tokens survive password reset  | agent/user | Accepted for now: access tokens last at most 1 hour and archived users are blocked. Add revocation on reset if required |
| Board cards can only be moved by mouse drag  | user       | Same as the source. Add a keyboard or menu alternative if accessibility is a requirement                                |
| Lockfiles must be generated with npm ≥ 11.19 | team       | Older npm writes lockfiles that `npm ci` in node:24-alpine rejects; CI's `docker build` step catches it                 |
| Staging rehearsal                            | user       | Run `npm run smoke:prod` and Playwright against staging before the DNS switch                                           |

## Limitations, rollback and user actions

- **Fresh start:** users must sign up again or be re-invited. Nothing from the Lovable app carries over.
- **Rollback:** point DNS back to the unchanged Lovable app (cutover.md).
- **Not production-verified:** nothing has been deployed. All results come from local Docker and an isolated database (`azf_e2e`, or throwaway Testcontainers databases).
