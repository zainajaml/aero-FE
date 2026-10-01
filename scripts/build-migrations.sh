#!/usr/bin/env bash
# One-off generator used to create the initial per-table migration history in dependency order.
set -euo pipefail
cd "$(dirname "$0")/.."
IDX=src/database/schema/index.ts
: > "$IDX"
add() { # $1 = module file, $2 = migration name
  echo "export * from \"./$1.js\";" >> "$IDX"
  npx drizzle-kit generate --name="$2" > /dev/null
  echo "generated $2"
}
add _shared create_app_role_enum
for pair in users sessions auth-accounts verifications profiles profile-private user-roles accounts \
  account-admins projects project-members board-columns rate-card sprints epics tickets ticket-watchers \
  ticket-estimates ticket-stage-history ticket-epics comments attachments work-logs time-off \
  document-folders documents invitations audit-logs support-issues support-messages \
  notification-preferences email-send-log email-send-state suppressed-emails email-unsubscribe-tokens \
  jira-connections jira-oauth-states jira-imports rate-limit-counters; do
  add "$pair" "create_${pair//-/_}"
done
