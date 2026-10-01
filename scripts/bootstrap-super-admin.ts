// Fresh-start bootstrap: invites the first super admin. No password is ever created here —
// the person accepts the emailed invitation and chooses their own.
// Usage: npm run bootstrap:super-admin -- someone@spacemanconsulting.com
import { eq, sql } from "drizzle-orm";
import { env } from "../src/config/env.js";
import { closeDatabase, db } from "../src/database/client.js";
import { invitations, userRoles } from "../src/database/schema/index.js";
import { newInvitationToken } from "../src/modules/invitations/invitations.tokens.js";
import { sendTemplateEmail } from "../src/modules/notifications/email.service.js";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error("Usage: bootstrap-super-admin <email>");
if (email.split("@")[1] !== env.SUPER_ADMIN_EMAIL_DOMAIN) {
  throw new Error(`Super admins must use an @${env.SUPER_ADMIN_EMAIL_DOMAIN} address`);
}

const [existing] = await db
  .select({ id: userRoles.id })
  .from(userRoles)
  .where(eq(userRoles.role, "super_admin"))
  .limit(1);
if (existing) throw new Error("A super admin already exists; invite further admins from the app.");
await db
  .update(invitations)
  .set({ revokedAt: new Date() })
  .where(sql`lower(${invitations.email}) = ${email} and ${invitations.acceptedAt} is null`);

const { token, tokenHash, expiresAt } = newInvitationToken();
const [invitation] = await db
  .insert(invitations)
  .values({ email, role: "super_admin", projectIds: [], accountIds: [], tokenHash, expiresAt })
  .returning();
const result = await sendTemplateEmail({
  template: "invite",
  to: email,
  data: {
    inviteUrl: `${env.APP_URL}/accept?token=${encodeURIComponent(token)}`,
    roleLabel: "Super Admin",
    projectName: null,
    invitedByName: "Space Scope",
    actorName: "Space Scope",
  },
  metadata: { invitation_id: invitation!.id, bootstrap: true },
  skipRecipientLimit: true,
});
console.log(
  `Super admin invitation for ${email}: email ${result.status}. It expires ${expiresAt.toISOString()}.`,
);
await closeDatabase();
