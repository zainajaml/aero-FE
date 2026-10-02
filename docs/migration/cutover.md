# Cutover runbook

Scope: **fresh start**. No rows, users or files are imported from Supabase. Users sign up again or are re-invited, and the Lovable app keeps running until DNS is switched.

## Before cutover (each item is a hard prerequisite)

1. **Decisions to close**
   - Choose the hosting target.
   - Choose the email provider (SMTP URL, SPF/DKIM/DMARC for the sender domain).
   - Choose the object storage provider (S3, R2 or similar).
   - Provide the Google OAuth credentials, or drop Google sign-in.
   - Provide a Gemini API key, or leave AI summaries off.
   - Provide the billing API credentials, or leave the Billing page off.
   - Register the Jira OAuth app, or leave Jira import off.
2. **Production values** (see `.env.example`)
   - `AUTH_SECRET` and `JIRA_TOKEN_ENCRYPTION_KEY`: generate with `openssl rand -base64 48` and store them in the secret manager. Rotating `AUTH_SECRET` later invalidates sessions and MCP signing keys.
   - `APP_URL` and `API_URL` must be the public HTTPS origins. For same-origin hosting, both are the frontend origin and nginx proxies `/api`, `/mcp` and `/.well-known/oauth-*`.
   - Set `TRUST_PROXY` to the number of proxies in front of the API.
3. **Database:** use managed PostgreSQL 17 with automated backups and point-in-time recovery enabled, then test a restore once (see "Restore drill").
4. **Images:** build both images from the tagged commits.
   - `docker build -t <registry>/aero-zenith-flow-backend:<tag> .` in the backend repo.
   - `docker build --build-arg VITE_API_URL= -t <registry>/aero-zenith-flow-frontend:<tag> .` in the frontend repo.
5. **Rehearsal:** run `npm run smoke:prod` in the backend against a staging database, then the Playwright journeys against staging (`E2E_BASE_URL=https://staging…`).
6. **Communication:** tell users the date, that they will need to create an account or accept a new invitation, and that nothing created in the old app after the date carries over.

## Cutover

1. Run `migrate` once (the `migrate` service in `docker-compose.prod.yml`, or `node dist/database/migrate.js`). It takes an advisory lock, so concurrent runs are safe.
2. Start the API. Wait for `/health/ready` to return 200.
3. Start the frontend. `/healthz` returns 200.
4. Invite the first super admin from a checkout of this repo with production settings: `npx tsx --env-file=.env.production scripts/bootstrap-super-admin.ts <email>`. The address must be in `SUPER_ADMIN_EMAIL_DOMAIN`. The script emails an invitation and never sets a password. The invitee accepts it, then creates accounts and projects and invites users.
5. Switch DNS to the new frontend.
6. Smoke test in production:
   - sign up and verify;
   - sign in;
   - create a project and a ticket;
   - upload an attachment;
   - receive an invitation email;
   - connect an MCP client.

## Rollback

Point DNS back to the Lovable app. The old app was not modified, so rollback is immediate. Data created in the new app during the window stays in the new database, which is kept for a later retry and not deleted.

## Thresholds that trigger rollback (first 24 hours)

- 5xx rate above 2% over 10 minutes (pino logs or the proxy).
- `/health/ready` failing for more than 2 minutes.
- Sign-up verification emails not delivered (check the provider dashboard and the notifications log).

## Restore drill

`pg_dump -Fc` the production database, then `pg_restore` it into a scratch database. Start the API against it with `DATABASE_URL` pointing there and check `/health/ready` plus one sign-in. Record the date and outcome in verification.md.
