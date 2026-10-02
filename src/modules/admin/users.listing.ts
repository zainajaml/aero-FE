import { db } from "../../database/client.js";
import type { AppRole } from "../../database/schema/_shared.js";
import { ForbiddenError } from "../../shared/http/errors.js";
import { requireAdminScope, type AdminScope } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import {
  CLIENT_ADMIN_INVITE_LIMIT,
  countProjectPeople,
} from "../invitations/invitations.service.js";
import { invitationProjectIds } from "../invitations/invitations.grant.js";
import * as repo from "./admin.repository.js";

export const HIDDEN_EMAIL_DOMAIN = "@jira-import.invalid";
const RANK: AppRole[] = ["super_admin", "account_admin", "admin", "developer", "team", "viewer"];

export type AdminContext = { accountId?: string | null; projectId?: string | null };
export type ClippedScope = { accountIds: string[]; projectIds: string[] };

/**
 * Narrows the caller's admin scope to the account/project open in the UI. Null means no narrowing;
 * a context the caller does not administer is refused (an administered-nothing account yields empty).
 */
async function clipScopeToContext(
  scope: AdminScope,
  context: AdminContext,
): Promise<ClippedScope | null> {
  if (!context.projectId && !context.accountId) return null;
  const allProjects = await repo.loadProjects(db);
  if (context.projectId) {
    const project = allProjects.find((p) => p.id === context.projectId);
    if (!project) throw new ForbiddenError("Unknown project context");
    const administers =
      scope.isGlobalAdmin ||
      scope.projectIds.includes(project.id) ||
      scope.accountIds.includes(project.accountId);
    if (!administers) throw new ForbiddenError("That project is outside your admin scope");
    return {
      projectIds: [project.id],
      accountIds:
        scope.isGlobalAdmin || scope.accountIds.includes(project.accountId)
          ? [project.accountId]
          : [],
    };
  }
  const accountId = context.accountId!;
  const administersAccount = scope.isGlobalAdmin || scope.accountIds.includes(accountId);
  const accountProjectIds = allProjects.filter((p) => p.accountId === accountId).map((p) => p.id);
  const projectIds = administersAccount
    ? accountProjectIds
    : accountProjectIds.filter((id) => scope.projectIds.includes(id));
  if (!administersAccount && projectIds.length === 0) return { projectIds: [], accountIds: [] };
  return { projectIds, accountIds: administersAccount ? [accountId] : [] };
}

/** User management listing (ports listOrgUsers): users, pending invitations, projects and scope flags. */
export async function listOrgUsers(actor: Actor, context: AdminContext) {
  const fullScope = await requireAdminScope(actor);
  const clipped = await clipScopeToContext(fullScope, context);
  const scope = clipped
    ? {
        ...fullScope,
        isGlobalAdmin: false,
        accountIds: clipped.accountIds,
        projectIds: clipped.projectIds,
      }
    : fullScope;

  const [profileRows, roleRows, memberRows, adminRows, projectRows, accountRows, inviteRows] =
    await Promise.all([
      repo.loadProfiles(db),
      repo.loadRoles(db),
      repo.loadMemberships(db),
      repo.loadAccountAdmins(db),
      repo.loadProjects(db),
      repo.loadAccounts(db),
      repo.loadPendingInvitations(db),
    ]);

  // user_roles is a display fallback only: a stale global row never overrides real grants.
  const globalRole = new Map<string, AppRole>();
  for (const row of roleRows) {
    const current = globalRole.get(row.userId);
    if (!current || RANK.indexOf(row.role) < RANK.indexOf(current))
      globalRole.set(row.userId, row.role);
  }
  const projectsByAccount = new Map<string, string[]>();
  for (const project of projectRows)
    projectsByAccount.set(project.accountId, [
      ...(projectsByAccount.get(project.accountId) ?? []),
      project.id,
    ]);

  const projectsByUser = new Map<string, Set<string>>();
  const accountsByUser = new Map<string, Set<string>>();
  const projectRoleByUser = new Map<string, Map<string, AppRole>>();
  const add = <K, V>(map: Map<K, Set<V>>, key: K, value: V) =>
    map.set(key, (map.get(key) ?? new Set<V>()).add(value));
  for (const member of memberRows) {
    add(projectsByUser, member.userId, member.projectId);
    projectRoleByUser.set(
      member.userId,
      (projectRoleByUser.get(member.userId) ?? new Map()).set(member.projectId, member.role),
    );
  }
  // Account admins are implicitly enrolled in every project of their accounts.
  for (const grant of adminRows) {
    for (const projectId of projectsByAccount.get(grant.accountId) ?? [])
      add(projectsByUser, grant.userId, projectId);
    add(accountsByUser, grant.userId, grant.accountId);
  }

  const contextProjectIds = clipped?.projectIds ?? null;
  const effectiveRole = (userId: string): AppRole | null => {
    const legacy = globalRole.get(userId) ?? null;
    if (legacy === "super_admin") return legacy;
    const administered = accountsByUser.get(userId);
    if (administered && administered.size > 0) {
      const inScope =
        clipped === null ||
        clipped.accountIds.length === 0 ||
        clipped.accountIds.some((id) => administered.has(id));
      if (inScope) return "account_admin";
    }
    const roles = projectRoleByUser.get(userId);
    if (roles && roles.size > 0) {
      const candidates = (
        contextProjectIds && contextProjectIds.length > 0 ? contextProjectIds : [...roles.keys()]
      )
        .map((id) => roles.get(id))
        .filter((role): role is AppRole => Boolean(role))
        .sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b));
      if (candidates[0]) return candidates[0];
    }
    return legacy;
  };

  const active = await repo.usersWithActivity(
    db,
    profileRows.map((p) => p.id),
  );
  let users = profileRows.map((profile) => ({
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    firstName: profile.firstName,
    lastName: profile.lastName,
    jobTitle: profile.jobTitle,
    createdAt: profile.createdAt.toISOString(),
    role: effectiveRole(profile.id),
    projectIds: [...(projectsByUser.get(profile.id) ?? [])],
    accountIds: [...(accountsByUser.get(profile.id) ?? [])],
    archivedAt: profile.archivedAt?.toISOString() ?? null,
    hasActivity: active.has(profile.id),
    emailHidden: (profile.email ?? "").toLowerCase().endsWith(HIDDEN_EMAIL_DOMAIN),
  }));
  let pending = inviteRows.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    projectIds: invitationProjectIds(invitation),
    accountIds: invitation.accountIds,
    jobTitle: invitation.jobTitle,
    invitedBy: invitation.invitedBy,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  }));
  let projectList = projectRows;

  if (!scope.isGlobalAdmin) {
    const scopeProjects = new Set(scope.projectIds);
    const scopeAccounts = new Set(scope.accountIds);
    // Project admins never see account-level or super admin identities.
    const projectAdminOnly = scopeAccounts.size === 0;
    users = users
      .filter((user) => {
        if (user.role === "super_admin") return false;
        if (projectAdminOnly && user.role === "account_admin") return false;
        if (user.id === actor.userId) return true;
        return (
          user.accountIds.some((id) => scopeAccounts.has(id)) ||
          user.projectIds.some((id) => scopeProjects.has(id))
        );
      })
      .map((user) => ({
        ...user,
        projectIds: user.projectIds.filter((id) => scopeProjects.has(id)),
        accountIds: user.accountIds.filter((id) => scopeAccounts.has(id)),
      }));
    pending = pending
      .filter((invitation) => {
        if (invitation.role === "super_admin") return false;
        if (projectAdminOnly && invitation.role === "account_admin") return false;
        return (
          invitation.accountIds.some((id) => scopeAccounts.has(id)) ||
          invitation.projectIds.some((id) => scopeProjects.has(id))
        );
      })
      .map((invitation) => ({
        ...invitation,
        projectIds: invitation.projectIds.filter((id) => scopeProjects.has(id)),
        accountIds: invitation.accountIds.filter((id) => scopeAccounts.has(id)),
      }));
    projectList = projectRows.filter((project) => scopeProjects.has(project.id));
  }
  const visibleAccounts = new Set([...projectList.map((p) => p.accountId), ...scope.accountIds]);
  const accountList = scope.isGlobalAdmin
    ? accountRows
    : accountRows.filter((account) => visibleAccounts.has(account.id));

  const limited = !fullScope.isGlobalAdmin && !fullScope.isAccountAdmin;
  const seats = limited ? await countProjectPeople(actor.userId, scope.projectIds) : {};
  return {
    users,
    invitations: pending,
    projects: projectList,
    accounts: accountList,
    scope: {
      isGlobalAdmin: fullScope.isGlobalAdmin,
      isAccountAdmin: fullScope.isAccountAdmin && !fullScope.isGlobalAdmin,
      isClientAdmin:
        fullScope.isProjectAdmin && !fullScope.isAccountAdmin && !fullScope.isGlobalAdmin,
      contextScoped: clipped !== null,
      contextIsAccountAdmin:
        fullScope.isGlobalAdmin ||
        (clipped ? clipped.accountIds.length > 0 : fullScope.isAccountAdmin),
      contextIsProjectAdmin: clipped
        ? clipped.projectIds.some((id) => fullScope.projectIds.includes(id))
        : fullScope.isProjectAdmin,
      inviteLimit: limited ? CLIENT_ADMIN_INVITE_LIMIT : null,
      invitesUsed: limited ? Math.max(0, ...Object.values(seats)) : 0,
    },
  };
}
