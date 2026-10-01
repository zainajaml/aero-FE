import { db } from "../../../database/client.js";
import { ConflictError, ValidationError } from "../../../shared/http/errors.js";
import { LIMITS, enforceRateLimit } from "../../../shared/security/rate-limit.js";
import type { Actor } from "../../access/access.types.js";
import { writeAuditEvent } from "../../audit/audit.service.js";
import { sendInviteEmail } from "../../invitations/invitations.email.js";
import { invitationProjectIds } from "../../invitations/invitations.grant.js";
import * as invitationsRepo from "../../invitations/invitations.repository.js";
import { newInvitationToken } from "../../invitations/invitations.tokens.js";
import { requireAccountAdmin } from "../jira.access.js";
import { jiraConfig } from "../jira.config.js";
import * as imports from "./import.repository.js";
import { normalizeEmail, toProgress } from "./import.mapping.js";
import { loadImport } from "./import.service.js";
import * as records from "./issue-records.repository.js";
import { addMember } from "./project-setup.repository.js";
import type { ImportRow } from "./import.types.js";

const VALID_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The caller's import, re-authorized on its account, with its project. */
async function adminImport(
  actor: Actor,
  importId: string,
): Promise<ImportRow & { projectId: string }> {
  const row = await loadImport(actor, importId);
  await requireAccountAdmin(actor, row.accountId);
  if (!row.projectId)
    throw new ConflictError("This import has no project yet.", "JIRA_IMPORT_NO_PROJECT");
  return row as ImportRow & { projectId: string };
}

/**
 * Invites people found in the import to its project as Team members. Only addresses that came
 * from this import's Jira people are accepted; an open invitation for the project is re-issued
 * (new link) instead of duplicated.
 */
export async function inviteImportedUsers(actor: Actor, importId: string, emails: string[]) {
  const row = await adminImport(actor, importId);
  const known = new Set(row.jiraUsers.map((e) => normalizeEmail(e.email)).filter(Boolean));
  const wanted = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  const targets = wanted.filter((email) => VALID_EMAIL.test(email) && known.has(email));
  const failed = wanted.filter((email) => !targets.includes(email));
  if (targets.length > 0) {
    await enforceRateLimit({
      namespace: "invite:create:account",
      identifier: row.accountId,
      windows: LIMITS.inviteCreateAccount,
      cost: targets.length,
    });
  }
  const [project] = await invitationsRepo.projectsByIds(db, [row.projectId]);
  let sent = 0;
  for (const email of targets) {
    try {
      const pending = (await invitationsRepo.listPendingForEmail(db, email)).find((invitation) =>
        invitationProjectIds(invitation).includes(row.projectId),
      );
      const { token, tokenHash, expiresAt } = newInvitationToken();
      const invitation = pending
        ? await invitationsRepo.refreshToken(db, pending.id, tokenHash, expiresAt)
        : await invitationsRepo.insertInvitation(db, {
            email,
            role: "team",
            projectId: row.projectId,
            projectIds: [row.projectId],
            accountIds: [row.accountId],
            invitedBy: actor.userId,
            tokenHash,
            expiresAt,
          });
      const ok =
        invitation &&
        (await sendInviteEmail({
          actorUserId: actor.userId,
          invitation,
          token,
          projectName: project?.name ?? null,
        }));
      if (ok) sent += 1;
      else failed.push(email);
    } catch {
      failed.push(email);
    }
  }
  // Counts only: tokens and the address list are not recorded.
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "create",
    event: "invitation.created_from_import",
    table: "invitations",
    entityId: row.id,
    projectId: row.projectId,
    accountId: row.accountId,
    link: "/jira",
    summary: "Invited people found in a Jira import",
    metadata: { invited: sent, failed: failed.length },
    critical: true,
  });
  return { sent, failed };
}

async function candidatesOf(actor: Actor, row: ImportRow) {
  const people = await imports.accountPeople(db, row.accountId, actor.userId);
  return people
    .filter((p) => !p.archivedAt)
    .map((p) => ({ id: p.id, name: p.fullName ?? p.email ?? "Unknown", email: p.email ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** People of the import's account an unresolved Jira person can be matched to. */
export async function listImportCandidates(actor: Actor, importId: string) {
  const row = await loadImport(actor, importId);
  await requireAccountAdmin(actor, row.accountId);
  return candidatesOf(actor, row);
}

/** Assigns every ticket (and stand-in comments/time logs) of a Jira person to a chosen user. */
export async function assignImportUsers(
  actor: Actor,
  importId: string,
  mappings: { key: string; userId: string }[],
) {
  const row = await adminImport(actor, importId);
  const allowed = new Set((await candidatesOf(actor, row)).map((c) => c.id));
  if (mappings.some((m) => !allowed.has(m.userId)))
    throw new ValidationError("Choose people who belong to this account.");

  const entries = row.jiraUsers;
  let assigned = 0;
  for (const mapping of mappings) {
    const entry = entries.find((e) => e.key === mapping.key);
    if (!entry) continue;
    if (mapping.userId !== actor.userId)
      await addMember(db, row.projectId, mapping.userId, "team", "keep");
    for (let i = 0; i < entry.ticketIds.length; i += 200) {
      await records.setAssignee(
        db,
        row.projectId,
        entry.ticketIds.slice(i, i + 200),
        mapping.userId,
      );
    }
    assigned += entry.ticketIds.length;
    if (entry.placeholderId && entry.placeholderId !== mapping.userId) {
      await records.reassignPlaceholder(db, row.projectId, entry.placeholderId, mapping.userId);
      entry.placeholderId = null;
    }
    entry.status = "matched";
    entry.userId = mapping.userId;
    entry.ticketIds = [];
  }
  await imports.patchImport(db, row.id, { jiraUsers: entries });
  const progress = toProgress({ ...row, jiraUsers: entries });
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: "jira.users_mapped",
    table: "jira_imports",
    entityId: row.id,
    projectId: row.projectId,
    link: "/jira",
    summary: "Matched Jira people to users",
    metadata: { assigned },
  });
  return { assigned, progress };
}

/** Whether this Jira project already lives in the account (offers a refresh, not a duplicate). */
export async function checkProjectImported(
  actor: Actor,
  input: { accountId: string; jiraProjectId: string; cloudId?: string | undefined },
) {
  jiraConfig();
  await requireAccountAdmin(actor, input.accountId);
  const project = await imports.findImportedProject(
    db,
    input.accountId,
    input.jiraProjectId,
    input.cloudId,
  );
  if (!project) return { imported: false, projectId: null, projectName: null, tickets: 0 };
  return {
    imported: true,
    projectId: project.id,
    projectName: project.name,
    tickets: await imports.countTickets(db, project.id),
  };
}
