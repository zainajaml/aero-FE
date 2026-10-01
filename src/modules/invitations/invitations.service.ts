import { eq } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import type { AppRole } from "../../database/schema/_shared.js";
import { users } from "../../database/schema/index.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/http/errors.js";
import { LIMITS, enforceRateLimit } from "../../shared/security/rate-limit.js";
import { requireAdminScope, type AdminScope } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import { auth } from "../auth/auth.js";
import { updateProfile } from "../users/profiles.repository.js";
import { displayNameFromEmail, roleLabel } from "../users/names.js";
import { sendInviteEmail } from "./invitations.email.js";
import { grantInvitation, invitationProjectIds } from "./invitations.grant.js";
import * as repo from "./invitations.repository.js";
import { hashToken, isWellFormedToken, newInvitationToken } from "./invitations.tokens.js";

/** Project admins may hold at most this many people (members + pending invites) per project. */
export const CLIENT_ADMIN_INVITE_LIMIT = 10;
const PROJECT_ROLES: AppRole[] = ["admin", "developer", "team", "viewer"];

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function summarizeProjectNames(rows: { name: string }[]): string | null {
  if (rows.length === 0) return null;
  return rows.length === 1 ? rows[0]!.name : `${rows[0]!.name} +${rows.length - 1} more`;
}

function assertSuperAdminDomain(email: string, role: AppRole) {
  if (role !== "super_admin") return;
  const domain = email.split("@")[1] ?? "";
  if (domain !== env.SUPER_ADMIN_EMAIL_DOMAIN) {
    throw new ValidationError(
      `Super Admin can only be granted to @${env.SUPER_ADMIN_EMAIL_DOMAIN} email addresses`,
    );
  }
}

/** Role-assignment rules (ported from assertRoleAssignable). */
async function assertRoleAssignable(
  scope: AdminScope,
  role: AppRole,
  projectIds: string[],
  accountIds: string[],
) {
  if (scope.isGlobalAdmin) return;
  if (role === "super_admin")
    throw new ForbiddenError("Only a Super Admin can assign the Super Admin role.");
  if (role !== "account_admin") return;
  if (!scope.isAccountAdmin) throw new ForbiddenError("You cannot assign the Account Admin role.");
  const targets =
    accountIds.length > 0 ? accountIds : await repo.accountIdsOfProjects(db, projectIds);
  if (targets.length === 0)
    throw new ValidationError("Select an account for the Account Admin role.");
  if (targets.some((id) => !scope.accountIds.includes(id))) {
    throw new ForbiddenError("You can only grant Account Admin for accounts you administer.");
  }
}

/** Seats per project: active non-super-admin members (excluding the caller) + pending invitees. */
export async function countProjectPeople(
  callerId: string,
  projectIds: string[],
): Promise<Record<string, number>> {
  const seats = new Map(projectIds.map((id) => [id, new Set<string>()]));
  for (const member of await repo.seatedMembers(db, projectIds, callerId)) {
    seats.get(member.projectId)?.add(`user:${member.userId}`);
  }
  for (const invitation of await repo.listOpenForProjects(db, projectIds)) {
    if (invitation.role === "super_admin") continue;
    for (const projectId of invitationProjectIds(invitation)) {
      seats.get(projectId)?.add(`email:${invitation.email.toLowerCase()}`);
    }
  }
  return Object.fromEntries([...seats].map(([id, set]) => [id, set.size]));
}

/** Who may resend/revoke a pending invitation (ported from assertInvitationManageable). */
function assertManageable(
  actor: Actor,
  scope: AdminScope,
  invitation: repo.InvitationRow,
  action: "resend" | "revoke",
) {
  if (scope.isGlobalAdmin) return;
  const projectIds = invitationProjectIds(invitation);
  const allowed =
    projectIds.some((id) => scope.projectIds.includes(id)) ||
    invitation.accountIds.some((id) => scope.accountIds.includes(id)) ||
    (projectIds.length === 0 &&
      invitation.accountIds.length === 0 &&
      invitation.invitedBy === actor.userId);
  if (!allowed)
    throw new ForbiddenError(
      `You can only ${action} invitations for accounts or projects you administer.`,
    );
}

export type CreateInvitationInput = {
  email: string;
  role: AppRole;
  projectIds?: string[] | null;
  accountIds?: string[] | null;
  jobTitle?: string | null;
};

export async function createInvitation(actor: Actor, input: CreateInvitationInput) {
  const accountScopeId = input.accountIds?.[0] ?? null;
  await enforceRateLimit({
    namespace: "invite:create:actor",
    identifier: actor.userId,
    windows: LIMITS.inviteCreateActor,
  });
  if (accountScopeId) {
    await enforceRateLimit({
      namespace: "invite:create:account",
      identifier: accountScopeId,
      windows: LIMITS.inviteCreateAccount,
    });
  }

  const scope = await requireAdminScope(actor);
  const email = normalizeEmail(input.email);
  assertSuperAdminDomain(email, input.role);
  const projectIds = [...new Set((input.projectIds ?? []).filter(Boolean))];
  const inputAccountIds =
    input.role === "account_admin" ? [...new Set((input.accountIds ?? []).filter(Boolean))] : [];
  await assertRoleAssignable(scope, input.role, projectIds, inputAccountIds);

  if (!scope.isGlobalAdmin) {
    if (projectIds.some((id) => !scope.projectIds.includes(id))) {
      throw new ForbiddenError("You can only invite users into projects you belong to.");
    }
    if (!scope.isAccountAdmin) {
      const target = projectIds.length > 0 ? projectIds : scope.projectIds;
      const counts = await countProjectPeople(actor.userId, target);
      if (target.some((id) => (counts[id] ?? 0) >= CLIENT_ADMIN_INVITE_LIMIT)) {
        throw new ConflictError(
          `This project has reached the ${CLIENT_ADMIN_INVITE_LIMIT}-person Project Admin limit.`,
          "SEAT_LIMIT_REACHED",
        );
      }
    }
  }
  if (PROJECT_ROLES.includes(input.role) && projectIds.length === 0) {
    throw new ValidationError("Client roles require at least one project");
  }

  let accountIds = inputAccountIds;
  if (input.role === "account_admin" && accountIds.length === 0)
    accountIds = await repo.accountIdsOfProjects(db, projectIds);
  if (input.role === "account_admin" && accountIds.length === 0) {
    throw new ValidationError("Select an account for the Account Admin role.");
  }

  const projects = await repo.projectsByIds(db, projectIds);
  if (projects.length !== projectIds.length)
    throw new NotFoundError("Project", "PROJECT_NOT_FOUND");

  // Already a member: role changes go through the edit-user flow instead of a new invitation.
  const existingUserId = await repo.findUserIdByEmail(db, email);
  if (existingUserId) {
    const memberOf = await repo.memberProjectIds(db, existingUserId, projectIds);
    if (memberOf.length > 0) {
      const names = projects.filter((p) => memberOf.includes(p.id)).map((p) => p.name);
      throw new ConflictError(
        `${email} is already a member of ${names.join(", ") || "this project"}.`,
        "ALREADY_MEMBER",
      );
    }
    const accountScope =
      projectIds.length > 0 ? [...new Set(projects.map((p) => p.accountId))] : accountIds;
    if ((await repo.administeredAccountIds(db, existingUserId, accountScope)).length > 0) {
      throw new ConflictError(
        `${email} is already an Account Admin for this account.`,
        "ALREADY_ACCOUNT_ADMIN",
      );
    }
  }

  // A pending invitation already covering one of these projects/accounts is reported, not duplicated.
  const pending = await repo.listPendingForEmail(db, email);
  const duplicate = pending.find((invitation) => {
    const ids = invitationProjectIds(invitation);
    if (projectIds.length > 0) return ids.some((id) => projectIds.includes(id));
    if (accountIds.length > 0) return invitation.accountIds.some((id) => accountIds.includes(id));
    return ids.length === 0;
  });
  if (duplicate) {
    const duplicateProjects = await repo.projectsByIds(db, invitationProjectIds(duplicate));
    return {
      duplicate: true as const,
      invitation: toInvitationDto(duplicate),
      projectName: summarizeProjectNames(duplicateProjects),
      emailQueued: false,
    };
  }

  const { token, tokenHash, expiresAt } = newInvitationToken();
  const invitation = await repo.insertInvitation(db, {
    email,
    role: input.role,
    projectId: projectIds[0] ?? null,
    projectIds,
    accountIds,
    jobTitle: input.jobTitle?.trim() || null,
    invitedBy: actor.userId,
    tokenHash,
    expiresAt,
  });
  const projectName = summarizeProjectNames(projects);
  const emailQueued = await sendInviteEmail({
    actorUserId: actor.userId,
    invitation,
    token,
    projectName,
  });
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "create",
    event: "invitation.created",
    table: "invitations",
    entityId: invitation.id,
    projectId: invitation.projectId,
    accountId: accountIds[0] ?? null,
    link: "/admin",
    summary: `Invited ${email} as ${roleLabel(input.role)}`,
    metadata: { role: input.role, email_queued: emailQueued },
    critical: true,
  });
  return {
    duplicate: false as const,
    invitation: toInvitationDto(invitation),
    projectName,
    emailQueued,
  };
}

export async function resendInvitation(actor: Actor, invitationId: string) {
  await enforceRateLimit({
    namespace: "invite:resend:actor",
    identifier: actor.userId,
    windows: LIMITS.inviteResendActor,
  });
  await enforceRateLimit({
    namespace: "invite:resend:invitation",
    identifier: invitationId,
    windows: LIMITS.inviteResendInvitation,
  });
  const scope = await requireAdminScope(actor);
  const invitation = await repo.findById(db, invitationId);
  if (!invitation || invitation.revokedAt)
    throw new NotFoundError("Invitation", "INVITATION_NOT_FOUND");
  if (invitation.acceptedAt)
    throw new ConflictError("This invitation was already accepted.", "INVITATION_ALREADY_ACCEPTED");
  assertManageable(actor, scope, invitation, "resend");

  // A new token invalidates the previous link and the 7-day window starts over.
  const { token, tokenHash, expiresAt } = newInvitationToken();
  const refreshed = await repo.refreshToken(db, invitation.id, tokenHash, expiresAt);
  if (!refreshed) throw new NotFoundError("Invitation", "INVITATION_NOT_FOUND");
  const projectName = summarizeProjectNames(
    await repo.projectsByIds(db, invitationProjectIds(refreshed)),
  );
  const emailQueued = await sendInviteEmail({
    actorUserId: actor.userId,
    invitation: refreshed,
    token,
    projectName,
  });
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: "invitation.resent",
    table: "invitations",
    entityId: refreshed.id,
    projectId: refreshed.projectId,
    link: "/admin",
    summary: `Resent the invitation for ${refreshed.email}`,
    metadata: { role: refreshed.role, email_queued: emailQueued },
  });
  return { emailQueued, email: refreshed.email };
}

export async function revokeInvitation(actor: Actor, invitationId: string) {
  const scope = await requireAdminScope(actor);
  const invitation = await repo.findById(db, invitationId);
  if (!invitation || invitation.revokedAt)
    throw new NotFoundError("Invitation", "INVITATION_NOT_FOUND");
  if (invitation.acceptedAt) {
    throw new ConflictError(
      "This invitation was already accepted and cannot be revoked.",
      "INVITATION_ALREADY_ACCEPTED",
    );
  }
  assertManageable(actor, scope, invitation, "revoke");
  await repo.revoke(db, invitation.id);
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "delete",
    event: "invitation.revoked",
    table: "invitations",
    entityId: invitation.id,
    link: "/admin",
    summary: "Revoked a pending invitation",
    critical: true,
  });
}

// ---------------------------------------------------------------- public (pre-session) flows

async function limitPublicSource(namespace: string, sourceKey: string) {
  await enforceRateLimit({ namespace, identifier: sourceKey, windows: LIMITS.invitePublicSource });
}

/** Resolves a token to an invitation, or null for malformed/unknown/revoked tokens alike. */
async function resolveToken(token: string): Promise<repo.InvitationRow | null> {
  if (!isWellFormedToken(token)) return null;
  const invitation = await repo.findByTokenHash(db, hashToken(token));
  return invitation && !invitation.revokedAt ? invitation : null;
}

async function landingContext(invitation: repo.InvitationRow) {
  const ids = invitationProjectIds(invitation);
  const projects = await repo.projectsByIds(db, ids);
  const first = projects.find((p) => p.id === (invitation.projectId ?? ids[0])) ?? projects[0];
  return {
    projectName: summarizeProjectNames(projects),
    projectId: first?.id ?? null,
    accountId: first?.accountId ?? invitation.accountIds[0] ?? null,
  };
}

/** Public lookup. Unknown, malformed and revoked tokens produce the same `{ valid: false }`. */
export async function lookupInvitation(token: string, sourceKey: string) {
  await limitPublicSource("invite:public:lookup:source", sourceKey);
  const invitation = await resolveToken(token.trim());
  if (!invitation) return { valid: false as const, expired: false };
  await enforceRateLimit({
    namespace: "invite:public:lookup",
    identifier: invitation.id,
    windows: LIMITS.invitePublicLookup,
  });
  if (!invitation.acceptedAt && invitation.expiresAt <= new Date())
    return { valid: false as const, expired: true };
  return {
    valid: true as const,
    expired: false,
    alreadyAccepted: invitation.acceptedAt !== null,
    email: invitation.email,
    roleLabel: roleLabel(invitation.role),
    userExists: (await repo.findUserIdByEmail(db, invitation.email)) !== null,
    ...(await landingContext(invitation)),
  };
}

const INVALID = () => new ValidationError("This invitation is no longer valid.");

/**
 * Creates a verified password account for an invited email and grants the invitation in one
 * transaction. The caller signs in afterwards with the same credentials.
 */
export async function acceptWithPassword(
  input: { token: string; password: string; firstName?: string | null; lastName?: string | null },
  sourceKey: string,
) {
  await limitPublicSource("invite:public:accept:source", sourceKey);
  const invitation = await resolveToken(input.token.trim());
  if (!invitation) throw INVALID();
  await enforceRateLimit({
    namespace: "invite:public:accept",
    identifier: invitation.id,
    windows: LIMITS.invitePublicAccept,
  });
  if (invitation.acceptedAt) {
    throw new ConflictError(
      "This invitation has already been accepted. Please sign in instead.",
      "INVITATION_ALREADY_ACCEPTED",
    );
  }
  if (invitation.expiresAt <= new Date())
    throw new ValidationError("This invitation has expired. Ask an admin to resend it.");
  if (await repo.findUserIdByEmail(db, invitation.email)) {
    throw new ConflictError(
      "An account already exists for this email. Please sign in instead.",
      "ACCOUNT_EXISTS",
    );
  }

  const firstName = input.firstName?.trim() || null;
  const lastName = input.lastName?.trim() || null;
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ") || displayNameFromEmail(invitation.email);
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(input.password);
  // Created unverified so the registration hook does not apply a different invitation first.
  const user = await ctx.internalAdapter.createUser(
    { email: invitation.email, name: fullName, emailVerified: false },
    { method: "email-password" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: passwordHash,
  });

  await db.transaction(async (tx) => {
    await grantInvitation(tx, user.id, invitation);
    await updateProfile(tx, user.id, { firstName, lastName, fullName });
    // Possession of the emailed token proves the address.
    await tx.update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
  });
  await writeAuditEvent({
    actorUserId: user.id,
    action: "update",
    event: "invitation.accepted",
    table: "invitations",
    entityId: invitation.id,
    projectId: invitation.projectId,
    link: "/dashboard",
    summary: "Accepted an invitation",
    critical: true,
  });
  return { email: invitation.email };
}

/** Signed-in acceptance: the invitation must be addressed to the caller's email. */
export async function acceptInvitation(actor: Actor, token: string) {
  const invitation = await resolveToken(token.trim());
  if (!invitation) throw INVALID();
  const context = await landingContext(invitation);
  if (invitation.acceptedAt) return { alreadyAccepted: true, ...context };
  if (invitation.expiresAt <= new Date())
    throw new ValidationError("This invitation has expired. Ask an admin to resend it.");
  if (normalizeEmail(actor.email) !== normalizeEmail(invitation.email)) {
    throw new ForbiddenError(
      "This invitation was sent to a different email address. Sign in with the invited account.",
      "INVITATION_EMAIL_MISMATCH",
    );
  }
  const granted = await db.transaction((tx) => grantInvitation(tx, actor.userId, invitation));
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: "invitation.accepted",
    table: "invitations",
    entityId: actor.userId,
    projectId: context.projectId,
    accountId: context.accountId ?? granted.accountIds[0] ?? null,
    link: "/dashboard",
    summary: "Accepted an invitation",
    critical: true,
  });
  return {
    alreadyAccepted: false,
    ...context,
    accountId: context.accountId ?? granted.accountIds[0] ?? null,
  };
}

function toInvitationDto(invitation: repo.InvitationRow) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    projectIds: invitationProjectIds(invitation),
    accountIds: invitation.accountIds,
    jobTitle: invitation.jobTitle,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}
