import type { DbExecutor } from "../../database/client.js";
import { ConflictError } from "../../shared/http/errors.js";
import type { AppRole } from "../../database/schema/_shared.js";
import * as profilesRepo from "../users/profiles.repository.js";
import { splitFullName } from "../users/names.js";
import * as repo from "./invitations.repository.js";

const ROLE_RANK: Record<AppRole, number> = {
  super_admin: 0,
  account_admin: 1,
  admin: 2,
  developer: 3,
  team: 4,
  viewer: 5,
};

export function invitationProjectIds(invitation: repo.InvitationRow): string[] {
  if (invitation.projectIds && invitation.projectIds.length > 0) return invitation.projectIds;
  return invitation.projectId ? [invitation.projectId] : [];
}

/**
 * Grants what an invitation promises, inside the caller's transaction. Ports the source
 * acceptInvitation + handle_new_user behavior:
 * - records the invited role only when it is more privileged than any role already held;
 * - account_admin invitations grant account_admins (invitation account_ids, else the projects' accounts);
 * - other roles grant project memberships with exactly the invited role;
 * - restores an archived identity, copies the job title and backfills split name fields;
 * - marks this invitation accepted (other pending invitations stay open for their own links).
 */
export async function grantInvitation(
  tx: DbExecutor,
  userId: string,
  invitation: repo.InvitationRow,
): Promise<{ accountIds: string[]; projectIds: string[] }> {
  // Claim first so concurrent accepts of the same invitation cannot both grant access.
  if (!(await repo.markAccepted(tx, invitation.id))) {
    throw new ConflictError(
      "This invitation has already been accepted",
      "INVITATION_ALREADY_ACCEPTED",
    );
  }
  const projectIds = invitationProjectIds(invitation);
  const existing = await repo.listRoles(tx, userId);
  const bestExisting = Math.min(99, ...existing.map((role) => ROLE_RANK[role]));
  if (ROLE_RANK[invitation.role] < bestExisting) await repo.addRole(tx, userId, invitation.role);

  let accountIds: string[] = [];
  if (invitation.role === "account_admin") {
    accountIds =
      invitation.accountIds.length > 0
        ? invitation.accountIds
        : await repo.accountIdsOfProjects(tx, projectIds);
    await repo.addAccountAdmins(tx, userId, accountIds);
  } else {
    await repo.upsertProjectMemberships(tx, userId, projectIds, invitation.role);
  }

  const profile = await profilesRepo.findProfile(tx, userId);
  const names =
    profile && !profile.firstName && !profile.lastName ? splitFullName(profile.fullName) : {};
  await profilesRepo.updateProfile(tx, userId, {
    archivedAt: null,
    archivedBy: null,
    ...(invitation.jobTitle ? { jobTitle: invitation.jobTitle } : {}),
    ...names,
  });
  return { accountIds, projectIds };
}
