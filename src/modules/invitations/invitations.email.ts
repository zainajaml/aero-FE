import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import { sendTemplateEmail } from "../notifications/email.service.js";
import { displayName, roleLabel } from "../users/names.js";
import { profileName } from "../users/profiles.repository.js";

/** Sends the team invite email; returns whether it was handed to the provider. */
export async function sendInviteEmail(input: {
  actorUserId: string;
  invitation: { id: string; email: string; role: string };
  token: string;
  projectName: string | null;
  projectIds: string[];
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
    metadata: {
      kind: "invite",
      invitation_id: input.invitation.id,
      actor_id: input.actorUserId,
      actor_name: actorName,
      project_ids: input.projectIds,
    },
  });
  return result.status === "sent";
}
