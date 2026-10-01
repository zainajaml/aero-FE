# Discovery — Space Scope (aero-zenith-flow) source application

Recorded 2026-10-01 from static analysis of the source repository. No live database or Lovable Cloud access was used.

## Project profile

| Dimension           | Finding                                                                                                                                                                                                                                             | Evidence                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Origin              | Lovable (template `tanstack_start_ts_2026-05-25`), 6,690 commits                                                                                                                                                                                    | `.lovable/project.json`, git log                                     |
| Backend hosting     | Lovable Cloud (Supabase project `zfnueaenoclaccvplkxp`)                                                                                                                                                                                             | `supabase/config.toml`, `@lovable.dev/*`, `LOVABLE_DB_MIGRATION_URL` |
| Frontend runtime    | TanStack Start + React 19 + Vite 7, Nitro → Cloudflare Workers; behaves as a client-only SPA except landing/blog/login/ticket deep link                                                                                                             | `vite.config.ts`, `ssr: false` on `/_authenticated`                  |
| Repository shape    | Single app; two competing migration histories (Supabase SQL + drizzle raw SQL)                                                                                                                                                                      | `supabase/migrations` (116), `drizzle/migrations` (8)                |
| Supabase features   | Database + RLS, Auth (email/password, Lovable-brokered Google, OAuth 2.1 server for MCP), Storage (4 private-ish buckets), Realtime (role watch only), pgmq (email queue, created outside repo). No Edge Functions, no pg_cron/pg_net/vault in repo | discovery agents' reports                                            |
| Auth model          | Email/password with verification + reset; Google; invitations; onboarding; MCP OAuth consent                                                                                                                                                        | `src/routes/{login,signup,accept,onboarding}.tsx`                    |
| Tenancy / roles     | accounts → projects → tickets. Global `user_roles` (super_admin…viewer), `account_admins`, per-project `project_members.role`                                                                                                                       | RLS helpers, `auth-context.tsx`                                      |
| Other clients       | MCP clients via `/mcp` (OAuth). No mobile apps found                                                                                                                                                                                                | `src/lib/mcp`, `.lovable/mcp/manifest.json`                          |
| Size                | 247 TS/TSX files, ~56.7k lines; ~35 tables; 18 RLS helper functions; ~110 policies; 4 buckets                                                                                                                                                       | `wc`, migrations                                                     |
| Tests / CI / Docker | None                                                                                                                                                                                                                                                | repo scan                                                            |

## Decisions recorded with the user (2026-10-01)

- Frontend: **React.js** (Vite SPA + TanStack Router/Query).
- Backend: **Express.js**.
- Scope: **leave Supabase, fresh start** — schema only; no rows, users or files imported. Row/identity/file import is NOT APPLICABLE.
- Repositories: `/home/zain-ajmal/www/aero-zenith-flow-frontend`, `/home/zain-ajmal/www/aero-zenith-flow-backend` (local git only).
- Open, defaulted: hosting (Docker images + managed Postgres + S3-compatible storage), email provider (SMTP adapter), AI (direct Gemini), MCP retained, Google only.

## Capability inventory (summary)

| Capability                                                                 | Source                                         | Target owner                               |
| -------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| Browser → ~25 tables via supabase-js + RLS                                 | route components, dialogs                      | feature modules with named endpoints       |
| ~50 `createServerFn` functions (service-role)                              | `src/lib/*.functions.ts`                       | backend modules                            |
| Lovable Emails (6 auth + 5 transactional templates, bounce webhook)        | `src/routes/lovable/email/*`, `src/lib/email*` | `notifications` module + SMTP provider     |
| Lovable AI Gateway (Gemini comment summary)                                | `rag-summary.functions.ts`                     | `ai` module, direct provider               |
| Lovable cloud-auth (Google broker)                                         | `src/integrations/lovable`                     | Better Auth Google provider                |
| Jira OAuth 3LO + import                                                    | `src/lib/jira*`, `/api/auth/jira/callback`     | `jira` module + jobs                       |
| MCP server (9 tools) + Supabase OAuth 2.1 consent                          | `src/lib/mcp`, consent route                   | `mcp` module + Better Auth MCP plugin      |
| Billing proxy (super admin)                                                | `billing.functions.ts`                         | `billing` module                           |
| Realtime role watch                                                        | `use-role-watch.ts`                            | SSE `/me/access-events` + polling fallback |
| Storage buckets attachments, document-images, avatars, support-attachments | various                                        | `files` module + S3-compatible store       |

## Security findings carried into the target

1. `profiles` self-update had no column restriction (archived users could un-archive themselves).
2. `document-images` bucket was `public = true`.
3. Invitations were applied on signup by email match without verification.
4. Jira tokens historically stored in plaintext (later envelope-encrypted with lazy upgrade).
5. `/email/unsubscribe` endpoint referenced by the UI does not exist.
6. AI summary and mention emails trust client-supplied text.
7. `jiraBinary` sends the Jira bearer token to non-Atlassian hosts.
8. Multi-step client writes (ticket create, stage history, estimate total, sprint delete) were not transactional.
9. Deleting an auth user cascaded to comments and work logs (history loss).
10. Several FKs missing (ticket_estimates, ticket_epics, epics, documents, stage history, support tables).

## Unknowns (do not block a fresh-start build)

- Live row counts, password-hash formats, objects created outside migrations (pg_cron, pgmq queues, vault) — irrelevant to fresh start; not inspected.
- Production secret values (Jira, billing, AI, email) — names only; values must be supplied at deployment.
- Whether external MCP clients are in active use (assumed yes).
