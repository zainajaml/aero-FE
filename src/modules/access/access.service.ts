import { db } from "../../database/client.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/errors.js";
import * as policy from "./access.policy.js";
import * as repo from "./access.repository.js";
import type { AccessStatus, Actor, ProjectScope } from "./access.types.js";

export function loadActor(userId: string): Promise<Actor | null> {
  return repo.findActor(db, userId);
}

/** Resolves a project the actor may see; unknown and invisible projects are the same 404. */
export async function requireProjectMember(actor: Actor, projectId: string): Promise<ProjectScope> {
  const scope = await repo.findProjectScope(db, projectId, actor.userId);
  if (!scope || !policy.isProjectMember(actor, scope))
    throw new NotFoundError("Project", "PROJECT_NOT_FOUND");
  return scope;
}

/** Member + not a viewer + project not archived. */
export async function requireProjectWriter(actor: Actor, projectId: string): Promise<ProjectScope> {
  const scope = await requireProjectMember(actor, projectId);
  assertCanWrite(actor, scope);
  return scope;
}

export function assertCanWrite(actor: Actor, scope: ProjectScope): void {
  if (scope.archivedAt) {
    throw new ConflictError(
      "This project is archived. Restore it to make changes.",
      "PROJECT_ARCHIVED",
    );
  }
  if (policy.isProjectViewer(actor, scope)) {
    throw new ForbiddenError("You have view-only access — changes are not allowed.", "VIEW_ONLY");
  }
}

export async function requireProjectManager(
  actor: Actor,
  projectId: string,
): Promise<ProjectScope> {
  const scope = await requireProjectMember(actor, projectId);
  if (!policy.canManageProject(actor, scope))
    throw new ForbiddenError("Only project admins can do this");
  return scope;
}

export function requireSuperAdmin(actor: Actor): void {
  if (!policy.isSuperAdmin(actor)) throw new ForbiddenError("Only super admins can do this");
}

export type AccessSummary = {
  status: AccessStatus;
  globalRoles: Actor["globalRoles"];
  adminAccountIds: string[];
  projectRoles: Record<string, string>;
  projectAccounts: Record<string, string>;
};

/** Read model behind the frontend AuthProvider and route gates (replaces four client table reads). */
export async function getAccessSummary(actor: Actor): Promise<AccessSummary> {
  const superAdmin = policy.isSuperAdmin(actor);
  const [memberships, visible] = await Promise.all([
    repo.listMemberships(db, actor.userId),
    actor.isArchived ? Promise.resolve([]) : repo.listVisibleProjectAccounts(db, actor, superAdmin),
  ]);
  return {
    status: policy.accessStatus(actor, memberships.length > 0),
    globalRoles: actor.globalRoles,
    adminAccountIds: actor.adminAccountIds,
    projectRoles: Object.fromEntries(memberships.map((m) => [m.projectId, m.role])),
    projectAccounts: Object.fromEntries(visible.map((p) => [p.projectId, p.accountId])),
  };
}

export type AdminScope = {
  isGlobalAdmin: boolean;
  isAccountAdmin: boolean;
  isProjectAdmin: boolean;
  /** Accounts administered (empty for super admins, who are unrestricted). */
  accountIds: string[];
  /** Projects administered through account grants or project admin role (empty for super admins). */
  projectIds: string[];
};

/**
 * Administrative reach of the actor (ports authz.server requireAdminScope). Account admins count by
 * grant or by role row; project admins by a real project_members admin role.
 */
export async function requireAdminScope(actor: Actor): Promise<AdminScope> {
  const isGlobalAdmin = policy.isSuperAdmin(actor);
  const isAccountAdmin =
    actor.globalRoles.includes("account_admin") || actor.adminAccountIds.length > 0;
  const adminProjectIds = isGlobalAdmin ? [] : await repo.listAdminProjectIds(db, actor.userId);
  const isProjectAdmin = adminProjectIds.length > 0;
  if (!isGlobalAdmin && !isAccountAdmin && !isProjectAdmin) {
    throw new ForbiddenError("Admin access required");
  }
  if (isGlobalAdmin)
    return { isGlobalAdmin, isAccountAdmin, isProjectAdmin, accountIds: [], projectIds: [] };
  const accountProjectIds = await repo.listProjectIdsInAccounts(db, actor.adminAccountIds);
  return {
    isGlobalAdmin,
    isAccountAdmin,
    isProjectAdmin,
    accountIds: actor.adminAccountIds,
    projectIds: [...new Set([...accountProjectIds, ...adminProjectIds])],
  };
}
