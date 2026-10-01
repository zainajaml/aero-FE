import { db } from "../../database/client.js";
import { isUniqueViolation } from "../../shared/http/database-errors.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/errors.js";
import * as policy from "../access/access.policy.js";
import { listVisibleProjectAccounts } from "../access/access.repository.js";
import type { Actor } from "../access/access.types.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import { projectStats } from "../projects/projects.repository.js";
import * as repo from "./accounts.repository.js";
import { firstFreeSlug, slugify } from "./slug.js";

const isAccountAdminAnywhere = (actor: Actor) =>
  policy.isSuperAdmin(actor) ||
  actor.globalRoles.includes("account_admin") ||
  actor.adminAccountIds.length > 0;

function requireAdminOfAccount(actor: Actor, accountId: string) {
  if (!policy.isSuperAdmin(actor) && !policy.isAccountAdmin(actor, accountId)) {
    throw new ForbiddenError("You are not an admin of this account");
  }
}

const nameTaken = (error: unknown): never => {
  if (isUniqueViolation(error, "accounts_name_unique"))
    throw new ConflictError("An account with this name already exists", "ACCOUNT_NAME_TAKEN");
  if (isUniqueViolation(error, "accounts_slug_unique"))
    throw new ConflictError("This slug is already in use", "ACCOUNT_SLUG_TAKEN");
  throw error;
};

const toAccountDto = (row: repo.AccountRow) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  createdAt: row.createdAt.toISOString(),
});

/** Accounts the caller can see: super admins all; others those they administer or hold a project in. */
export async function listVisibleAccounts(actor: Actor) {
  if (policy.isSuperAdmin(actor))
    return (await repo.listAccounts(db, { all: true })).map(toAccountDto);
  const viaProjects = (await listVisibleProjectAccounts(db, actor, false)).map((p) => p.accountId);
  const ids = [...new Set([...actor.adminAccountIds, ...viaProjects])];
  return (await repo.listAccounts(db, { ids })).map(toAccountDto);
}

/** Administered accounts with their projects (ports superListAccounts). */
export async function listAdministeredAccounts(actor: Actor) {
  if (!isAccountAdminAnywhere(actor)) throw new ForbiddenError("Admin access required");
  const accounts = policy.isSuperAdmin(actor)
    ? await repo.listAccounts(db, { all: true })
    : await repo.listAccounts(db, { ids: actor.adminAccountIds });
  const projects = await repo.projectsOfAccounts(
    db,
    accounts.map((a) => a.id),
  );
  return accounts.map((account) => ({
    ...toAccountDto(account),
    projects: projects
      .filter((p) => p.accountId === account.id)
      .map((p) => ({ id: p.id, name: p.name, key: p.key })),
  }));
}

export async function createAccount(actor: Actor, input: { name: string; slug?: string | null }) {
  if (!isAccountAdminAnywhere(actor)) throw new ForbiddenError("Admin access required");
  const name = input.name.trim();
  const account = await db
    .transaction(async (tx) => {
      const base = input.slug?.trim() || slugify(name);
      const created = await repo.insertAccount(tx, {
        name,
        slug: input.slug?.trim() ? base : firstFreeSlug(base, await repo.slugsLike(tx, base)),
        createdBy: actor.userId,
      });
      // Non-super creators administer what they create.
      if (!policy.isSuperAdmin(actor)) await repo.addAccountAdmin(tx, created.id, actor.userId);
      return created;
    })
    .catch(nameTaken);
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "create",
    event: "account.created",
    table: "accounts",
    entityId: account.id,
    accountId: account.id,
    link: "/admin",
    summary: `Created account ${name}`,
    critical: true,
  });
  return toAccountDto(account);
}

export async function updateAccount(
  actor: Actor,
  accountId: string,
  input: { name?: string; slug?: string },
) {
  requireAdminOfAccount(actor, accountId);
  const patch = {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.slug !== undefined ? { slug: input.slug.trim() } : {}),
  };
  const updated = await repo.updateAccount(db, accountId, patch).catch(nameTaken);
  if (!updated) throw new NotFoundError("Account", "ACCOUNT_NOT_FOUND");
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: "account.updated",
    table: "accounts",
    entityId: accountId,
    accountId,
    link: "/admin",
    summary: "Updated account details",
    metadata: { fields: Object.keys(patch), name: patch.name, slug: patch.slug },
  });
  return toAccountDto(updated);
}

/** Deletes an account; with projects present it requires `force` and removes them in one transaction. */
export async function deleteAccount(actor: Actor, accountId: string, force: boolean) {
  requireAdminOfAccount(actor, accountId);
  const deletedProjects = await db.transaction(async (tx) => {
    if (!(await repo.findAccount(tx, accountId)))
      throw new NotFoundError("Account", "ACCOUNT_NOT_FOUND");
    const projectCount = await repo.countProjects(tx, accountId);
    if (projectCount > 0 && !force) {
      throw new ConflictError(
        "Move or delete this account's projects first",
        "ACCOUNT_HAS_PROJECTS",
      );
    }
    return repo.deleteAccountCascade(tx, accountId);
  });
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "delete",
    event: "account.deleted",
    table: "accounts",
    entityId: accountId,
    accountId,
    link: "/admin",
    summary: "Deleted an account",
    metadata: { deleted_projects: deletedProjects, forced: force },
    critical: true,
  });
  return { deletedProjects };
}

/** Everything the caller has scope over in one payload (ports listMyWorkspace). */
export async function getMyWorkspace(actor: Actor) {
  const superAdmin = policy.isSuperAdmin(actor);
  const accounts =
    superAdmin || actor.adminAccountIds.length > 0
      ? await repo.listAccounts(db, superAdmin ? { all: true } : { ids: actor.adminAccountIds })
      : [];
  const accountIds = accounts.map((a) => a.id);
  const memberRoles = new Map(
    (await repo.memberships(db, actor.userId)).map((m) => [m.projectId, m.role as string]),
  );
  const accountProjects = await repo.projectsOfAccounts(db, accountIds);
  const standaloneIds = [...memberRoles.keys()].filter(
    (id) => !accountProjects.some((p) => p.id === id),
  );
  const standalone = await repo.projectsByIds(db, standaloneIds);
  const stats = new Map(
    (
      await projectStats(
        db,
        [...accountProjects, ...standalone].map((p) => p.id),
      )
    ).map((s) => [s.projectId, s]),
  );
  const otherAccounts = await repo.listAccounts(db, {
    ids: [...new Set(standalone.map((p) => p.accountId))],
  });
  const summary = (p: (typeof accountProjects)[number]) => ({
    id: p.id,
    name: p.name,
    key: p.key,
    projectType: p.projectType,
    createdAt: p.createdAt.toISOString(),
    members: stats.get(p.id)?.members ?? 0,
    sprints: stats.get(p.id)?.sprints ?? 0,
    tickets: stats.get(p.id)?.tickets ?? 0,
  });
  return {
    accounts: accounts.map((account) => ({
      ...toAccountDto(account),
      projects: accountProjects.filter((p) => p.accountId === account.id).map(summary),
    })),
    projects: standalone.map((p) => ({
      ...summary(p),
      role: memberRoles.get(p.id) ?? "member",
      accountId: p.accountId,
      accountName: otherAccounts.find((a) => a.id === p.accountId)?.name ?? "Account",
    })),
  };
}
