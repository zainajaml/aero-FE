import { db } from "../../database/client.js";
import { grantInvitation } from "../invitations/invitations.grant.js";
import { findLatestOpenForEmail } from "../invitations/invitations.repository.js";
import { ensureProfile } from "../users/profiles.repository.js";
import { displayNameFromEmail, splitFullName } from "../users/names.js";

// Replaces the source `handle_new_user` trigger on auth.users. Difference by design: an invitation
// is applied only once the email address is verified, so nobody can claim an invited address by
// signing up with it unverified.

type CreatedUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
};

/** Applies the newest open invitation for the email, if any. Returns whether one was applied. */
export async function applyOpenInvitation(userId: string, email: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const invitation = await findLatestOpenForEmail(tx, email);
    if (!invitation) return false;
    await grantInvitation(tx, userId, invitation);
    return true;
  });
}

export async function onUserCreated(user: CreatedUser): Promise<void> {
  const fullName = user.name.trim() || displayNameFromEmail(user.email);
  await ensureProfile(db, {
    id: user.id,
    email: user.email,
    fullName,
    ...splitFullName(fullName),
    avatarUrl: user.image,
  });
  // Google sign-ins arrive verified; password sign-ups wait for verification.
  if (user.emailVerified) await applyOpenInvitation(user.id, user.email);
}

export async function onEmailVerified(user: { id: string; email: string }): Promise<void> {
  await applyOpenInvitation(user.id, user.email);
}
