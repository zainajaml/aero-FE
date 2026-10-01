import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import { sendTemplateEmail } from "../notifications/email.service.js";
import { displayName, roleLabel } from "../users/names.js";
import { profileName } from "./invitations.repository.js";

/** Sends the team invite email; returns whether it was handed to the provider. */
export async function sendInviteEmail(input: {
  actorUserId: string;
  invitation: { id: string; email: string; role: string };
  token: string;
  projectName: string | null;
}): Promise<boolean> {
  const actorName = displayName(await profileName(db, input.actorUserId), "Someone");
  const inviteUrl = `${env.APP_URL}/accept?token=${encodeURIComponent(input.token)}`;
  const result = await sendTemplateEmail({
    template: "invite",
    to: input.invitation.email,
    data: {
      inviteUrl,
      roleLabel: roleLabel(input.invitation.role),
      projectName: input.projectName,
      invitedByName: actorName,
      actorName,
    },
    metadata: { invitation_id: input.invitation.id },
  });
  return result.status === "sent";
}
