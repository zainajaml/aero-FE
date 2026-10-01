import { z } from "zod";
import { appRoleSchema } from "../access/me.schemas.js";

export const invitationSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: appRoleSchema,
    projectIds: z.array(z.uuid()),
    accountIds: z.array(z.uuid()),
    jobTitle: z.string().nullable(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Invitation" });

export const createInvitationBody = z
  .object({
    email: z.string().trim().min(3).max(320).pipe(z.email("Enter a valid email address")),
    role: appRoleSchema,
    projectIds: z.array(z.uuid()).max(100).nullish(),
    accountIds: z.array(z.uuid()).max(50).nullish(),
    jobTitle: z.string().trim().max(120).nullish(),
  })
  .meta({ id: "CreateInvitationRequest" });

export const createInvitationResult = z
  .object({
    duplicate: z
      .boolean()
      .describe(
        "True when a pending invitation already covers this email and scope; nothing was sent",
      ),
    invitation: invitationSchema,
    projectName: z.string().nullable(),
    emailQueued: z.boolean(),
  })
  .meta({ id: "CreateInvitationResult" });

export const invitationIdParams = z.object({ invitationId: z.uuid() });

export const resendResult = z
  .object({ emailQueued: z.boolean(), email: z.email() })
  .meta({ id: "ResendInvitationResult" });

// Public endpoints take the token in the body (never the URL) and bound sizes only; the strict
// format check runs after rate limiting so malformed tokens are indistinguishable from unknown ones.
const looseToken = z.string().max(500);

export const lookupBody = z.object({ token: looseToken }).meta({ id: "InvitationLookupRequest" });

export const lookupResult = z
  .object({
    valid: z.boolean(),
    expired: z.boolean(),
    alreadyAccepted: z.boolean().optional(),
    email: z.email().optional(),
    roleLabel: z.string().optional(),
    userExists: z.boolean().optional(),
    projectName: z.string().nullable().optional(),
    projectId: z.uuid().nullable().optional(),
    accountId: z.uuid().nullable().optional(),
  })
  .meta({ id: "InvitationLookupResult" });

export const acceptWithPasswordBody = z
  .object({
    token: looseToken,
    password: z.string().min(8, "Password must be at least 8 characters.").max(128),
    firstName: z.string().trim().max(80).nullish(),
    lastName: z.string().trim().max(80).nullish(),
  })
  .meta({ id: "AcceptInvitationWithPasswordRequest" });

export const acceptWithPasswordResult = z
  .object({ email: z.email() })
  .meta({ id: "AcceptInvitationWithPasswordResult" });

export const acceptBody = z.object({ token: looseToken }).meta({ id: "AcceptInvitationRequest" });

export const acceptResult = z
  .object({
    alreadyAccepted: z.boolean(),
    projectName: z.string().nullable(),
    projectId: z.uuid().nullable(),
    accountId: z.uuid().nullable(),
  })
  .meta({ id: "AcceptInvitationResult" });
