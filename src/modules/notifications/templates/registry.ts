import type { TemplateEntry } from "./template-entry.js";
import { template as commentMentionTemplate } from "./comment-mention.js";
import { EmailChangeEmail } from "./email-change.js";
import { RecoveryEmail } from "./recovery.js";
import { SignupEmail } from "./signup.js";
import { template as supportAdminAlertTemplate } from "./support-admin-alert.js";
import { template as supportReplyTemplate } from "./support-reply.js";
import { template as inviteTemplate } from "./team-invite.js";
import { template as ticketAssignmentTemplate } from "./ticket-assignment.js";

export const TEMPLATES = {
  "verify-email": {
    component: SignupEmail,
    subject: "Confirm your email",
    displayName: "Email verification",
  },
  "password-reset": {
    component: RecoveryEmail,
    subject: "Reset your password",
    displayName: "Password reset",
  },
  "email-change": {
    component: EmailChangeEmail,
    subject: "Confirm your new email",
    displayName: "Email change",
  },
  invite: inviteTemplate,
  "support-reply": supportReplyTemplate,
  "support-admin-alert": supportAdminAlertTemplate,
  "comment-mention": commentMentionTemplate,
  "ticket-assignment": ticketAssignmentTemplate,
} satisfies Record<string, TemplateEntry>;

export type TemplateName = keyof typeof TEMPLATES;
