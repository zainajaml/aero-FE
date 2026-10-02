# Migration plan and progress

```text
Migration progress:
- [x] 1. Discover (docs/migration/discovery.md)
- [x] 2. Target stack and scope confirmed: React + Express, fresh start
- [x] 3. Architecture, trees, ledger and plan presented (docs/migration/architecture.md)
- [x] 4. Foundations: both repositories (config, DB + migrations, auth, errors, health, OpenAPI, API client)
- [x] 5. Vertical features: ledger.md (29 verified; Google sign-in blocked on credentials; bounce webhook deferred)
- [x] 6. Deployment rehearsal: production images, compose stack, smoke-prod.sh (data/identity/file import NOT APPLICABLE: fresh start)
- [x] 7. Verification gates (verification.md)
- [x] 8. Runtime API acceptance on an isolated test DB (api-coverage.md: 146/146 success and failure)
- [x] 9. Final report (report.md)
```

## Sequence

1. Foundations (both repos).
2. Auth, access, invitations, onboarding (W-01…W-04, W-26) — reference slice incl. denied paths.
3. Accounts and projects (W-05…W-07).
4. Sprints, tickets, board, epics (W-08…W-11, W-14).
5. Comments, notifications/email, files/attachments (W-12, W-15, W-22).
6. Work logs, profile, time off (W-13, W-18).
7. Documents (W-15).
8. Reporting + AI (W-16, W-17).
9. Admin, super admin, audit, support, billing (W-19…W-21, W-23).
10. Jira with background jobs (W-24).
11. MCP server + OAuth (W-25).
12. Hardening: Docker prod, CI, cycles/unused scans, runtime acceptance, report.

## Rollback

The Lovable application stays live and unchanged until the new stack passes every gate. Cutover is a DNS switch; because of the fresh-start decision, data written to the old app after cutover is not carried over (communicate to users).

## Decisions taken during implementation

| Date       | Decision                                                                                                 | Reason                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 2026-10-01 | TypeScript pinned to 5.9                                                                                 | TS 7 (native) not yet supported by drizzle-kit / typescript-eslint          |
| 2026-10-01 | Drizzle migrations generated one table per file in FK order; functions/triggers as custom SQL migrations | Skill granularity rule; single migration authority                          |
| 2026-10-01 | DB guards (archive, account-admin exclusivity) apply to every writer; custom SQLSTATE AZ001/AZ002        | Source bypassed guards when `auth.uid()` was null                           |
| 2026-10-01 | Invitations applied only after email verification; accepting marks only that invitation                  | Security finding 3; avoid silently consuming other invitations              |
| 2026-10-01 | comments.author_id / work_logs.user_id → users ON DELETE RESTRICT                                        | Preserve history (finding 9); users with activity are archived              |
| 2026-10-01 | Invitation and unsubscribe tokens stored as SHA-256 hashes                                               | Source stored plaintext tokens                                              |
| 2026-10-01 | Email sent synchronously with bounded retry and logged with rendered HTML                                | Matches source behavior; enables real admin retry (source retry was broken) |
| 2026-10-01 | MinIO image unavailable; storage service chosen in the files slice                                       | `minio/minio` no longer pullable                                            |
| 2026-10-01 | Better Auth sign-in response includes session token in JSON body (library behavior)                      | Accepted; cookie is HttpOnly; tracked as known exposure                     |
| 2026-10-01 | MCP endpoint accepts 2025-era clients statelessly as well as 2026-07-28                                  | Rejecting older clients would break MCP connectors that have not upgraded   |
| 2026-10-02 | Expired rate-limit windows, verifications and OAuth tokens purged hourly in-process                      | Replaces the source's opportunistic purge; no job queue needed              |
| 2026-10-02 | pg-boss removed; Jira import runs as client-driven steps                                                 | No background job needs a queue; fewer moving parts                         |
