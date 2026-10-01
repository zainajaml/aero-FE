import { and, eq, inArray, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db, type DbExecutor } from "../../database/client.js";
import type { AppRole } from "../../database/schema/_shared.js";
import { boardColumns, profiles, projects, tickets } from "../../database/schema/index.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/http/errors.js";
import { requireAdminScope, type AdminScope } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import { listProjectAccessibleUsers } from "../users/people.repository.js";
import { displayName } from "../users/names.js";
import * as repo from "./admin.repository.js";
import { HIDDEN_EMAIL_DOMAIN } from "./users.listing.js";

const PROJECT_ROLES: AppRole[] = ["admin", "developer", "team", "viewer"];

async function summary(userId: string) {
  const [roles, memberships, grants] = await Promise.all([
    repo.rolesOf(db, userId),
    repo.membershipsOf(db, userId),
    repo.adminAccountsOf(db, userId),
  ]);
  return {
    role: roles[0] ?? memberships[0]?.role ?? null,
    projectCount: memberships.length,
    isAccountAdmin: grants.length > 0,
  };
}

/** Accounts behind projects, or the explicit accounts list for account_admin grants. */
async function accountsFor(projectIds: string[], accountIds?: string[] | null) {
  if (accountIds && accountIds.length > 0) return [...new Set(accountIds)];
  return [...new Set((await repo.projectAccounts(db, projectIds)).values())];
}

export type UpdateAccessInput = {
  role: AppRole;
  projectIds?: string[] | null;
  /** Explicit accounts for account_admin (works for accounts without projects). */
  accountIds?: string[] | null;
  jobTitle?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contextAccountId?: string | null;
  contextProjectId?: string | null;
};

async function assertManageable(actor: Actor, scope: AdminScope, targetUserId: string) {
  if (scope.isGlobalAdmin) return;
  if ((await repo.rolesOf(db, targetUserId)).includes("super_admin"))
    throw new ForbiddenError("You cannot modify a super admin.");
  if (targetUserId === actor.userId) return;
  const [memberships, grants] = await Promise.all([
    repo.membershipsOf(db, targetUserId),
    repo.adminAccountsOf(db, targetUserId),
  ]);
  const shared =
    memberships.some((m) => scope.projectIds.includes(m.projectId)) ||
    grants.some((id) => scope.accountIds.includes(id));
  if (!shared) throw new ForbiddenError("You can only manage users in your projects.");
}

/**
 * Changes a user's role and access (ports updateUserRole). Writes stay inside the account/project
 * open in the UI, so access elsewhere is untouched. Runs in one transaction.
 */
export async function updateUserAccess(
  actor: Actor,
  targetUserId: string,
  input: UpdateAccessInput,
) {
  const scope = await requireAdminScope(actor);
  const before = await summary(targetUserId);
  try {
    if (!scope.isGlobalAdmin && input.role === "super_admin")
      throw new ForbiddenError("Only a Super Admin can assign the Super Admin role.");
    if (!scope.isGlobalAdmin && input.role === "account_admin" && !scope.isAccountAdmin)
      throw new ForbiddenError("You cannot assign the Account Admin role.");
    await assertManageable(actor, scope, targetUserId);

    let contextProjectIds: string[] | null = null;
    let contextAccountIds: string[] | null = null;
    if (input.contextProjectId) {
      contextProjectIds = [input.contextProjectId];
      contextAccountIds = [...(await repo.projectAccounts(db, [input.contextProjectId])).values()];
    } else if (input.contextAccountId) {
      contextAccountIds = [input.contextAccountId];
      contextProjectIds = await repo.projectIdsOfAccounts(db, [input.contextAccountId]);
    }
    const inContextProject = (id: string) =>
      contextProjectIds === null || contextProjectIds.includes(id);
    const inContextAccount = (id: string) =>
      contextAccountIds === null || contextAccountIds.includes(id);

    const requested = [...new Set((input.projectIds ?? []).filter(Boolean))];
    const requestedAccounts = await repo.projectAccounts(db, requested);
    if (requestedAccounts.size !== requested.length)
      throw new NotFoundError("Project", "PROJECT_NOT_FOUND");
    if (
      !scope.isGlobalAdmin &&
      requested.some(
        (id) =>
          !scope.projectIds.includes(id) && !scope.accountIds.includes(requestedAccounts.get(id)!),
      )
    ) {
      throw new ForbiddenError("You can only assign access within accounts you administer.");
    }
    const desiredAccounts =
      input.role === "account_admin" ? await accountsFor(requested, input.accountIds) : [];
    if (input.role === "account_admin") {
      if (desiredAccounts.length === 0)
        throw new ValidationError("Select an account for the Account Admin role.");
      if (!scope.isGlobalAdmin && desiredAccounts.some((id) => !scope.accountIds.includes(id))) {
        throw new ForbiddenError("You can only grant Account Admin for accounts you administer.");
      }
    }
    if (input.role === "super_admin") {
      const email = (await repo.findUserEmail(db, targetUserId)) ?? "";
      if (email.split("@")[1] !== env.SUPER_ADMIN_EMAIL_DOMAIN) {
        throw new ValidationError(
          `Super Admin can only be granted to @${env.SUPER_ADMIN_EMAIL_DOMAIN} email addresses`,
        );
      }
    }
    if (
      PROJECT_ROLES.includes(input.role) &&
      input.projectIds &&
      requested.length === 0 &&
      scope.isGlobalAdmin
    ) {
      throw new ValidationError("Client roles require at least one project");
    }

    await db.transaction(async (tx) => {
      // Never leave an account without an account admin (the source checked only self-demotion).
      const currentGrants = await repo.adminAccountsOf(tx, targetUserId);
      const losing = currentGrants.filter(
        (id) =>
          !desiredAccounts.includes(id) &&
          inContextAccount(id) &&
          (scope.isGlobalAdmin || scope.accountIds.includes(id)),
      );
      for (const accountId of losing) {
        if (!(await repo.otherAdminExists(tx, accountId, targetUserId))) {
          throw new ConflictError(
            "This is the last Account Admin of the account. Assign another Account Admin first.",
            "LAST_ACCOUNT_ADMIN",
          );
        }
      }
      await repo.setSingleRole(tx, targetUserId, input.role);
      if (input.role === "account_admin") {
        await repo.removeAccountAdmins(tx, targetUserId, losing);
        await repo.addAccountAdminGrants(tx, targetUserId, desiredAccounts);
      } else {
        const clearable = scope.isGlobalAdmin
          ? contextAccountIds
          : (contextAccountIds ?? scope.accountIds).filter((id) => scope.accountIds.includes(id));
        await repo.removeAccountAdmins(tx, targetUserId, clearable);
        if (input.projectIds !== undefined && input.projectIds !== null) {
          const existing = (await repo.membershipsOf(tx, targetUserId)).map((m) => m.projectId);
          const removable = existing.filter(
            (id) =>
              !requested.includes(id) &&
              (scope.isGlobalAdmin || scope.projectIds.includes(id)) &&
              inContextProject(id),
          );
          await repo.removeMemberships(tx, targetUserId, removable);
          await repo.upsertMemberships(tx, targetUserId, requested, input.role);
        }
      }
      await updateProfileFields(tx, scope, targetUserId, input);
    });

    const after = await summary(targetUserId);
    await writeAuditEvent({
      actorUserId: actor.userId,
      action: "update",
      event: "user.role_changed",
      table: "user_roles",
      entityId: targetUserId,
      projectId: input.contextProjectId ?? null,
      accountId: input.contextAccountId ?? null,
      link: "/admin",
      summary: "Changed a user's role or access",
      metadata: {
        previous_role: before.role,
        new_role: after.role,
        previous_projects: before.projectCount,
        new_projects: after.projectCount,
        account_admin: after.isAccountAdmin,
      },
      critical: true,
    });
    return { ok: true as const };
  } catch (error) {
    await writeAuditEvent({
      actorUserId: actor.userId,
      action: "update",
      event: "user.role_change_failed",
      table: "user_roles",
      entityId: targetUserId,
      link: "/admin",
      summary: "Role change rejected",
      metadata: {
        requested_role: input.role,
        reason: error instanceof Error ? error.message : "unknown",
      },
      critical: true,
    });
    throw error;
  }
}

/** Job title for any admin in scope; names only for super and account admins. */
async function updateProfileFields(
  tx: DbExecutor,
  scope: AdminScope,
  userId: string,
  input: UpdateAccessInput,
) {
  const patch: Partial<typeof profiles.$inferInsert> = {};
  if (input.jobTitle !== undefined) patch.jobTitle = input.jobTitle?.trim() || null;
  if (
    (scope.isGlobalAdmin || scope.isAccountAdmin) &&
    (input.firstName !== undefined || input.lastName !== undefined)
  ) {
    const [current] = await tx
      .select({ firstName: profiles.firstName, lastName: profiles.lastName })
      .from(profiles)
      .where(eq(profiles.id, userId));
    const firstName =
      input.firstName !== undefined
        ? input.firstName?.trim() || null
        : (current?.firstName ?? null);
    const lastName =
      input.lastName !== undefined ? input.lastName?.trim() || null : (current?.lastName ?? null);
    Object.assign(patch, {
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" "),
    });
  }
  if (Object.keys(patch).length > 0)
    await tx.update(profiles).set(patch).where(eq(profiles.id, userId));
}

/**
 * Removes project/account access within the caller's scope (ports deleteOrgUser). History is never
 * touched. A super admin may delete an identity that has no footprint and no remaining access.
 */
export async function removeAccess(actor: Actor, targetUserId: string, projectId: string | null) {
  const scope = await requireAdminScope(actor);
  if (targetUserId === actor.userId)
    throw new ConflictError("You cannot remove your own access", "SELF_REMOVAL");
  try {
    if (!scope.isGlobalAdmin && (await repo.rolesOf(db, targetUserId)).includes("super_admin"))
      throw new ForbiddenError("You cannot remove a super admin.");
    const [memberships, grants] = await Promise.all([
      repo.membershipsOf(db, targetUserId),
      repo.adminAccountsOf(db, targetUserId),
    ]);
    const inScope = (id: string) => scope.isGlobalAdmin || scope.projectIds.includes(id);
    let targetProjects: string[];
    if (projectId) {
      if (!inScope(projectId))
        throw new ForbiddenError("You can only remove users from your own projects.");
      targetProjects = memberships.some((m) => m.projectId === projectId) ? [projectId] : [];
    } else {
      targetProjects = memberships.map((m) => m.projectId).filter(inScope);
    }
    const accountsInPlay = projectId
      ? [...(await repo.projectAccounts(db, [projectId])).values()]
      : grants;
    const targetAccounts = accountsInPlay.filter(
      (id) => grants.includes(id) && (scope.isGlobalAdmin || scope.accountIds.includes(id)),
    );

    if (targetProjects.length === 0 && targetAccounts.length === 0) {
      const footprint = (await repo.usersWithActivity(db, [targetUserId])).has(targetUserId);
      if (scope.isGlobalAdmin && !footprint && memberships.length === 0 && grants.length === 0) {
        await repo.deleteIdentity(db, targetUserId);
        await writeAuditEvent({
          actorUserId: actor.userId,
          action: "delete",
          event: "user.deleted",
          table: "project_members",
          entityId: targetUserId,
          link: "/admin",
          summary: "Deleted a SpaceScope user with no remaining footprint",
          critical: true,
        });
        return { deleted: true, removedProjects: 0, hasRemainingAccess: false };
      }
      throw new ConflictError("This user has no project access to remove.", "NO_ACCESS_TO_REMOVE");
    }
    await db.transaction(async (tx) => {
      await repo.removeMemberships(tx, targetUserId, targetProjects);
      await repo.removeAccountAdmins(tx, targetUserId, targetAccounts);
    });
    const [left, leftGrants] = await Promise.all([
      repo.membershipsOf(db, targetUserId),
      repo.adminAccountsOf(db, targetUserId),
    ]);
    const result = {
      deleted: false,
      removedProjects: targetProjects.length,
      hasRemainingAccess: left.length + leftGrants.length > 0,
    };
    await writeAuditEvent({
      actorUserId: actor.userId,
      action: "delete",
      event: "user.access_removed",
      table: "project_members",
      entityId: targetUserId,
      projectId,
      link: "/admin",
      summary: "Removed a user's project access",
      metadata: {
        removed_projects: result.removedProjects,
        has_remaining_access: result.hasRemainingAccess,
      },
      critical: true,
    });
    return result;
  } catch (error) {
    await writeAuditEvent({
      actorUserId: actor.userId,
      action: "delete",
      event: "user.access_removal_failed",
      table: "project_members",
      entityId: targetUserId,
      projectId,
      link: "/admin",
      summary: "Access removal rejected",
      metadata: { reason: error instanceof Error ? error.message : "unknown" },
      critical: true,
    });
    throw error;
  }
}

/** Open tickets assigned to a user (not done, project not archived) and who could take them over. */
export async function openTickets(actor: Actor, targetUserId: string) {
  const scope = await requireAdminScope(actor);
  const rows = await db
    .select({
      id: tickets.id,
      code: tickets.code,
      title: tickets.title,
      projectId: tickets.projectId,
      projectName: projects.name,
    })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .leftJoin(boardColumns, eq(boardColumns.id, tickets.columnId))
    .where(
      and(
        eq(tickets.assigneeId, targetUserId),
        sql`${projects.archivedAt} is null`,
        sql`not coalesce(${boardColumns.isDone}, false)`,
      ),
    );
  const visible = rows.filter(
    (row) => scope.isGlobalAdmin || scope.projectIds.includes(row.projectId),
  );
  const projectIds = [...new Set(visible.map((row) => row.projectId))];
  const candidates =
    projectIds.length === 1
      ? (await listProjectAccessibleUsers(db, projectIds[0]!))
          .filter((p) => p.userId !== targetUserId)
          .map((p) => ({ id: p.userId, name: displayName(p, "Unknown") }))
      : [];
  return {
    tickets: visible,
    singleProjectId: projectIds.length === 1 ? projectIds[0]! : null,
    candidates,
  };
}

async function reassign(
  tx: DbExecutor,
  scope: AdminScope,
  targetUserId: string,
  assigneeId: string | null,
) {
  const { tickets: open, candidates } = await openTicketsWith(tx, scope, targetUserId);
  if (assigneeId && !candidates.includes(assigneeId))
    throw new ValidationError("The new assignee must have access to the project");
  if (open.length > 0)
    await tx.update(tickets).set({ assigneeId }).where(inArray(tickets.id, open));
  return open.length;
}

async function openTicketsWith(tx: DbExecutor, scope: AdminScope, targetUserId: string) {
  const rows = await tx
    .select({ id: tickets.id, projectId: tickets.projectId })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .leftJoin(boardColumns, eq(boardColumns.id, tickets.columnId))
    .where(
      and(
        eq(tickets.assigneeId, targetUserId),
        sql`${projects.archivedAt} is null`,
        sql`not coalesce(${boardColumns.isDone}, false)`,
      ),
    );
  const visible = rows.filter(
    (row) => scope.isGlobalAdmin || scope.projectIds.includes(row.projectId),
  );
  const projectIds = [...new Set(visible.map((row) => row.projectId))];
  const candidates =
    projectIds.length === 1
      ? (await listProjectAccessibleUsers(tx, projectIds[0]!))
          .map((p) => p.userId)
          .filter((id) => id !== targetUserId)
      : [];
  return { tickets: visible.map((row) => row.id), candidates };
}

/** Super admins archive identities (optionally reassigning open tickets in the same transaction). */
export async function archiveUser(
  actor: Actor,
  targetUserId: string,
  reassignTo?: { assigneeId: string | null },
) {
  const scope = await requireAdminScope(actor);
  if (!scope.isGlobalAdmin)
    throw new ForbiddenError("Only a super admin can archive a SpaceScope user.");
  if (targetUserId === actor.userId)
    throw new ConflictError("You cannot archive your own account", "SELF_ARCHIVE");
  const reassigned = await db.transaction(async (tx) => {
    const moved = reassignTo ? await reassign(tx, scope, targetUserId, reassignTo.assigneeId) : 0;
    const rows = await tx
      .update(profiles)
      .set({ archivedAt: new Date(), archivedBy: actor.userId })
      .where(eq(profiles.id, targetUserId))
      .returning({ id: profiles.id });
    if (rows.length === 0) throw new NotFoundError("User", "USER_NOT_FOUND");
    return moved;
  });
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: "user.archived",
    table: "profiles",
    entityId: targetUserId,
    link: "/admin",
    summary: "Archived a SpaceScope identity",
    metadata: { reassigned_tickets: reassigned },
    critical: true,
  });
  return { archived: true, reassignedTickets: reassigned };
}

export async function restoreUser(actor: Actor, targetUserId: string) {
  const scope = await requireAdminScope(actor);
  if (!scope.isGlobalAdmin)
    throw new ForbiddenError("Only a super admin can restore a SpaceScope user.");
  const rows = await db
    .update(profiles)
    .set({ archivedAt: null, archivedBy: null })
    .where(eq(profiles.id, targetUserId))
    .returning({ id: profiles.id });
  if (rows.length === 0) throw new NotFoundError("User", "USER_NOT_FOUND");
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: "user.restored",
    table: "profiles",
    entityId: targetUserId,
    link: "/admin",
    summary: "Restored a SpaceScope identity",
    critical: true,
  });
  return { archived: false, reassignedTickets: 0 };
}

export async function reassignOpenTickets(
  actor: Actor,
  targetUserId: string,
  assigneeId: string | null,
) {
  const scope = await requireAdminScope(actor);
  await assertManageable(actor, scope, targetUserId);
  const moved = await db.transaction((tx) => reassign(tx, scope, targetUserId, assigneeId));
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: "tickets.reassigned",
    table: "tickets",
    entityId: targetUserId,
    link: "/admin",
    summary: "Reassigned open tickets",
    metadata: { count: moved },
  });
  return { reassignedTickets: moved };
}

/** Gives a Jira-imported placeholder identity its real email (super and account admins). */
export async function setImportedEmail(actor: Actor, targetUserId: string, rawEmail: string) {
  const scope = await requireAdminScope(actor);
  if (!scope.isGlobalAdmin && !scope.isAccountAdmin)
    throw new ForbiddenError("Only account admins can add an email for an imported person.");
  const email = rawEmail.trim().toLowerCase();
  if (email.endsWith(HIDDEN_EMAIL_DOMAIN))
    throw new ValidationError("Enter the person's real email address.");
  const current = await repo.findUserEmail(db, targetUserId);
  if (current === null) throw new NotFoundError("User", "USER_NOT_FOUND");
  if (!current.toLowerCase().endsWith(HIDDEN_EMAIL_DOMAIN))
    throw new ConflictError("This person already has an email address.", "EMAIL_ALREADY_SET");
  if (
    !scope.isGlobalAdmin &&
    !(await repo.membershipsOf(db, targetUserId)).some((m) =>
      scope.projectIds.includes(m.projectId),
    )
  ) {
    throw new ForbiddenError("That person is outside your admin scope.");
  }
  if (await repo.emailTaken(db, email, targetUserId))
    throw new ConflictError(
      "Someone already uses that email. Map the imported work to them instead.",
      "EMAIL_TAKEN",
    );
  await db.transaction((tx) => repo.setUserEmail(tx, targetUserId, email));
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: "user.email_set",
    table: "profiles",
    entityId: targetUserId,
    link: "/admin",
    summary: "Added an email for an imported person",
    critical: true,
  });
  return { email };
}
