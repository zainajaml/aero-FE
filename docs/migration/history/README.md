# Historical source evidence (read-only)

Copied from the Lovable source repository `aero-zenith-flow` at commit f121c702 on 2026-10-01.

- `supabase-migrations/` — 116 Supabase migrations (2026-05-28 → 2026-08-26).
- `drizzle-migrations/` — 8 later raw-SQL migrations run with drizzle-kit against the same database.
- `supabase-config.toml` — Supabase project reference.

These files are **never executed** by this backend. The only migration authority is
`src/database/migrations/`. See `../schema-coverage.md` for how every source object maps to the new schema.
