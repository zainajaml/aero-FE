# aero-zenith-flow-backend

Express 5 + PostgreSQL API for Space Scope. Replaces the Supabase/Lovable backend of the original
`aero-zenith-flow` application. The React frontend lives in the sibling `aero-zenith-flow-frontend`
repository and consumes `openapi/openapi.json`.

## Local development

```bash
cp .env.example .env            # then set AUTH_SECRET (openssl rand -base64 48)
docker compose -f docker-compose.dev.yml up -d --wait   # Postgres :5434, test Postgres :5435, Mailpit :8026
npm ci
npm run db:migrate
npm run dev                     # http://localhost:4000, Swagger UI at /api/docs
```

Emails are captured by Mailpit at http://localhost:8026.

## Checks

| Command                                                       | Purpose                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm test`                                                    | Unit + integration tests against a throwaway Testcontainers PostgreSQL built from every migration |
| `npm run typecheck` / `npm run lint` / `npm run format:check` | Static checks                                                                                     |
| `npm run deps:cycles`                                         | Fails on circular imports                                                                         |
| `npm run deps:unused`                                         | Unused files, exports and dependencies (knip)                                                     |
| `npm run db:check`                                            | Fails when the Drizzle schema and migrations drift                                                |
| `npm run openapi:generate`                                    | Regenerates `openapi/openapi.json`                                                                |

## Layout

- `src/modules/<module>` — feature modules (routes → service → repository, plus policy and schemas).
- `src/shared` — HTTP envelope, errors, validation, security middleware, logging.
- `src/database` — Drizzle schema (one file per table), migrations (single authority), client, migrator.
- `docs/migration` — migration evidence: discovery, architecture, plan, ledger, schema coverage.
