import { db } from "../../database/client.js";
import { isUniqueViolation } from "../../shared/http/database-errors.js";
import { ConflictError, ForbiddenError, ValidationError } from "../../shared/http/errors.js";
import * as accountsRepo from "../accounts/accounts.repository.js";
import { firstFreeSlug, slugify } from "../accounts/slug.js";
import type { Actor } from "../access/access.types.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import { normalizeProjectKey, type ProjectType } from "../projects/project-defaults.js";
import * as projectsRepo from "../projects/projects.repository.js";
import { updateProfile } from "../users/profiles.repository.js";
import * as repo from "./onboarding.repository.js";

/** Where the user is in the self-serve wizard, so it can resume after a reload. */
export async function getOnboardingState(actor: Actor) {
  const accountId = await repo.firstAdministeredAccountId(db, actor.userId);
  const hasMembership = Boolean(accountId) || (await repo.hasProjectMembership(db, actor.userId));
  const account = accountId ? await accountsRepo.findAccount(db, accountId) : null;
  const project = accountId ? await projectsRepo.firstProjectOfAccount(db, accountId) : null;
  return {
    accountId,
    accountName: account?.name ?? null,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    projectKey: project?.key ?? null,
    projectType: (project?.projectType as ProjectType | undefined) ?? null,
    roles: actor.globalRoles,
    hasMembership,
  };
}

/** Step 1 — create the workspace (account) and make the caller its admin; stepping back renames it. */
export async function createWorkspace(
  actor: Actor,
  input: { name: string; firstName?: string | null; lastName?: string | null },
) {
  const name = input.name.trim();
  const firstName = input.firstName?.trim() || null;
  const lastName = input.lastName?.trim() || null;

  const result = await db
    .transaction(async (tx) => {
      if (firstName || lastName) {
        await updateProfile(tx, actor.userId, {
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
          fullName: [firstName, lastName].filter(Boolean).join(" "),
        });
      }
      const existingAccountId = await repo.firstAdministeredAccountId(tx, actor.userId);
      if (existingAccountId) {
        await accountsRepo.renameAccount(tx, existingAccountId, name);
        return { accountId: existingAccountId, created: false };
      }
      // Only users who belong nowhere may self-serve a workspace.
      if (await repo.hasProjectMembership(tx, actor.userId)) {
        throw new ConflictError(
          "This account already belongs to a workspace.",
          "ALREADY_ONBOARDED",
        );
      }
      const base = slugify(name);
      const account = await accountsRepo.insertAccount(tx, {
        name,
        slug: firstFreeSlug(base, await accountsRepo.slugsLike(tx, base)),
        createdBy: actor.userId,
      });
      await repo.makeSoleAccountAdmin(tx, actor.userId, account.id);
      return { accountId: account.id, created: true };
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, "accounts_name_unique")) {
        throw new ConflictError("A workspace with this name already exists.", "ACCOUNT_NAME_TAKEN");
      }
      throw error;
    });

  await writeAuditEvent({
    actorUserId: actor.userId,
    action: result.created ? "create" : "update",
    event: result.created ? "onboarding.workspace_created" : "onboarding.workspace_renamed",
    table: "accounts",
    entityId: result.accountId,
    accountId: result.accountId,
    link: "/admin",
    summary: result.created
      ? "Workspace created during onboarding"
      : "Workspace renamed during onboarding",
    metadata: { role: "account_admin" },
    critical: result.created,
  });
  return { accountId: result.accountId, role: "account_admin" as const };
}

/** Step 2 — create the first project (or update it when the user stepped back). */
export async function createFirstProject(
  actor: Actor,
  input: {
    accountId: string;
    name: string;
    key: string;
    projectType: ProjectType;
    projectId?: string | null;
  },
) {
  if (!(await repo.isAccountAdminOf(db, actor.userId, input.accountId))) {
    throw new ForbiddenError(
      "You are not an admin of this account. Please sign out and sign in again, then retry.",
    );
  }
  const name = input.name.trim();
  const key = normalizeProjectKey(input.key);
  if (key.length < 2) throw new ValidationError("Project key must be 2-8 letters or numbers");

  const result = await db.transaction(async (tx) => {
    const existing = input.projectId ? await projectsRepo.findProject(tx, input.projectId) : null;
    if (existing && existing.accountId === input.accountId) {
      if (await projectsRepo.isKeyTaken(tx, key, existing.id)) {
        throw new ConflictError(`Project key ${key} is already in use`, "PROJECT_KEY_TAKEN");
      }
      await projectsRepo.updateProject(tx, existing.id, {
        name,
        key,
        projectType: input.projectType,
      });
      // Board style changed — replace the default columns to match.
      if (existing.projectType !== input.projectType) {
        await projectsRepo.replaceWithDefaultColumns(tx, existing.id, input.projectType);
      }
      return { projectId: existing.id, projectName: name, updated: true };
    }
    if (await projectsRepo.isKeyTaken(tx, key)) {
      throw new ConflictError(`Project key ${key} is already in use`, "PROJECT_KEY_TAKEN");
    }
    const project = await projectsRepo.insertProject(tx, {
      name,
      key,
      accountId: input.accountId,
      projectType: input.projectType,
      ownerId: actor.userId,
    });
    // The creator is the account admin, which already grants full access to every project in the
    // account (account admins hold no per-project seats; enforced by a database trigger).
    await projectsRepo.insertDefaultColumns(tx, project.id, input.projectType);
    return { projectId: project.id, projectName: project.name, updated: false };
  });

  await writeAuditEvent({
    actorUserId: actor.userId,
    action: result.updated ? "update" : "create",
    event: result.updated ? "onboarding.project_updated" : "onboarding.project_created",
    table: "projects",
    entityId: result.projectId,
    projectId: result.projectId,
    accountId: input.accountId,
    link: "/projects",
    summary: `${result.updated ? "Updated" : "Created"} first project ${result.projectName}`,
    metadata: { project_type: input.projectType },
  });
  return { projectId: result.projectId, projectName: result.projectName };
}
