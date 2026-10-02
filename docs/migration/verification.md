# Verification

Results of the backend verification gates, recorded on 2026-10-02 (UTC) at commit `5ac7736`
plus this document.

## Environment

- Linux 7.0.0-31-generic, Node.js v24.13.0, Docker 29.8.0
- Tests: Vitest 5 with Testcontainers (`postgres:17-alpine`, `rustfs/rustfs:latest`); the schema is
  built from zero by running every migration (`src/database/migrate.ts`) before the suite
- Smoke test: dev compose services (`postgres-test` PostgreSQL 17.11 on 127.0.0.1:5435, RustFS on
  9100, Mailpit on 1026/8026); a fresh `azf_smoke_<ts>_test` database per run, dropped afterwards

## Static checks and build

| Command                                                                 | Result                               |
| ----------------------------------------------------------------------- | ------------------------------------ |
| `npm run typecheck`                                                     | pass                                 |
| `npm run lint`                                                          | pass                                 |
| `npm run format:check`                                                  | pass                                 |
| `npm run deps:cycles`                                                   | pass (no circular dependency)        |
| `npm run deps:unused` (`knip`)                                          | pass (exit 0, no findings)           |
| `npm run db:check`                                                      | pass (schema and migrations in sync) |
| `npm run openapi:generate && git diff --exit-code openapi/openapi.json` | pass (no drift)                      |
| `npm run build`                                                         | pass                                 |
| `npm test`                                                              | pass: 25 files, 396 tests            |
| `npm run test:api-coverage`                                             | pass: 146/146 operations covered     |

## Runtime API acceptance gate

`npm run test:api-coverage` runs the whole suite with `API_COVERAGE_FILE` set. In that mode
(`NODE_ENV=test` only) the app records `{ method, path, status }` for every `/api/v1` response,
where `path` is the matched route pattern tagged by `mountRoutes`. `scripts/api-coverage.ts`
then compares those records with every operation in `openapi/openapi.json`. Success means a 2xx
or 3xx was observed, and failure means a 4xx was observed. The script writes
[`api-coverage.md`](./api-coverage.md) and exits non-zero on any gap that is not listed with a
reason in `tests/acceptance/not-applicable.ts`.

| Metric                                    | Value                            |
| ----------------------------------------- | -------------------------------- |
| Documented operations                     | 146                              |
| Success-covered                           | 146                              |
| Failure-covered                           | 146                              |
| Failure covered by a 403/404/409/429 case | 76 (others: 401 and/or 400 only) |
| Not applicable (allowlist)                | 0                                |

The acceptance tests are in `tests/acceptance/`:

- `auth-guard.test.ts`: every authenticated operation returns 401 with the error envelope to
  anonymous callers. Every operation with a UUID path parameter returns 400 `VALIDATION_FAILED` for
  a malformed id. The public operation set is pinned, so a new public route has to be added on
  purpose.
- `project-workflows.test.ts`: board columns, sprints (edit, reorder, started sprints can't move),
  epics, the project estimate and stage-history read models, work logs, ticket deletion with
  logged time, comment edits, attachment listing and document folders. Each case also checks the
  role denial (403) and the outsider response (404).
- `people-and-admin.test.ts`: private profile, notification preferences, administered accounts
  and rename, notification detail visibility, the sprint report and its filters, admin ticket
  reassignment, and bad input on the public unsubscribe and Jira callback endpoints.
- `external-services.test.ts`: the billing proxy and the AI comment summary, run against fake
  upstreams at the `fetch` boundary.

## Production-mode smoke test

`npm run smoke:prod` (`scripts/smoke-prod.sh`) does the following:

1. Starts or reuses the compose services.
2. Creates a throwaway database.
3. Runs `npm run build`, then `node dist/database/migrate.js`.
4. Starts `node dist/server.js` with `NODE_ENV=production` on the first free port from 4310.
5. Checks the server over HTTP with curl.
6. Stops the server, drops the database and stops any services the script started itself.

The app has no `/health` route. The probes are `/health/live` and `/health/ready`.

```text
== services: postgres-test storage mailpit (starting: none)
created database azf_smoke_1790918877_test on 127.0.0.1:5435
== npm run build
== node dist/database/migrate.js
migrations applied
== node dist/server.js (NODE_ENV=production, port 4310)
== checks
PASS  GET /health/live                                           200
PASS  GET /health/ready (database reachable)                     200
PASS  GET /api/v1/me without a session                           401
PASS    error envelope code                                      UNAUTHENTICATED
PASS    error envelope requestId                                 true
PASS  GET /api/docs (disabled in production)                     404
PASS  GET /api/openapi.json (disabled in production)             404
PASS    helmet header                                            nosniff
PASS  POST /api/auth/sign-up/email                               200
PASS  POST /api/auth/sign-in/email before verifying              403
PASS  verification email delivered to Mailpit                    true
PASS  GET verification link (redirects to the app)               302
PASS  POST /api/auth/sign-in/email after verifying               200
PASS    session cookie is __Secure- prefixed                     true
PASS    session cookie is Secure; HttpOnly                       true
PASS  GET /api/v1/me with the session                            200
PASS    /me returns the signed-up email                          smoke-1790918877-8032@example.com

SMOKE PASSED
server stopped
dropped database azf_smoke_1790918877_test
```

## Browser journeys (2026-10-02)

Environment:

- Backend from this repo (`tsx src/server.ts`) on port 4200, against a database built from all migrations from zero (`azf_e2e` on the dev Postgres 17 container).
- Frontend Vite dev server on port 5190, proxying `/api`.
- Mailpit for email; RustFS for storage.

Command (frontend repo): `E2E_BASE_URL=http://localhost:5190 MAILPIT_URL=http://localhost:8026 npx playwright test`

Result: 11 passed, 11 passed (two runs in a row, 34.3s and 31.3s).

Covered:

- auth: sign-up → verify → onboarding, sign-in with a wrong password denied, route guard;
- tickets: create, edit, comment, log time, deep link;
- sprint planning and a real board drag;
- invitation and a viewer's read-only view;
- documents;
- support widget;
- notifications, including invitations;
- profile and preferences.

## Startup configuration check

The server exits with code 1 and a named error ("AUTH_SECRET: Invalid input…" / "Too small: expected >=32 characters") when `AUTH_SECRET` is missing or too short.
