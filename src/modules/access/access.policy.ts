import type { Actor, AccessStatus, ProjectScope } from "./access.types.js";

// Pure permission rules ported from the source RLS helper functions
// (is_global_admin, is_account_admin, is_project_member, can_manage_project, is_project_viewer).
// Every rule denies archived identities.

export function isSuperAdmin(actor: Actor): boolean {
  return !actor.isArchived && actor.globalRoles.includes("super_admin");
}

export function isAccountAdmin(actor: Actor, accountId: string): boolean {
  return !actor.isArchived && actor.adminAccountIds.includes(accountId);
}

/** Super admins, admins of the project's account, and project members. */
export function isProjectMember(actor: Actor, scope: ProjectScope): boolean {
  if (actor.isArchived) return false;
  return isSuperAdmin(actor) || isAccountAdmin(actor, scope.accountId) || scope.memberRole !== null;
}

/** Super admins, admins of the project's account, and members with the project admin role. */
export function canManageProject(actor: Actor, scope: ProjectScope): boolean {
  if (actor.isArchived) return false;
  return (
    isSuperAdmin(actor) || isAccountAdmin(actor, scope.accountId) || scope.memberRole === "admin"
  );
}

/** Read-only participants: project viewers, and anyone who is not a member at all. */
export function isProjectViewer(actor: Actor, scope: ProjectScope): boolean {
  if (isSuperAdmin(actor) || isAccountAdmin(actor, scope.accountId)) return false;
  return scope.memberRole === null || scope.memberRole === "viewer";
}

/** Create/update rights on project content: a non-viewer member of a project that is not archived. */
export function canWriteProject(actor: Actor, scope: ProjectScope): boolean {
  return (
    isProjectMember(actor, scope) && !isProjectViewer(actor, scope) && scope.archivedAt === null
  );
}

/**
 * Mirrors the source app gate: archived identities are blocked; users without any role still
 * need onboarding; users with a role but no membership have lost access.
 */
export function accessStatus(actor: Actor, hasProjectMembership: boolean): AccessStatus {
  if (actor.isArchived) return "archived";
  if (isSuperAdmin(actor)) return "active";
  if (hasProjectMembership || actor.adminAccountIds.length > 0) return "active";
  return actor.globalRoles.length === 0 ? "needs_onboarding" : "no_access";
}
