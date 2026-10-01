import { z } from "zod";
import { APP_ROLES } from "../../database/schema/_shared.js";

export const appRoleSchema = z.enum(APP_ROLES).meta({ id: "AppRole" });

export const accessSummarySchema = z
  .object({
    status: z.enum(["active", "needs_onboarding", "no_access", "archived"]),
    globalRoles: z.array(appRoleSchema),
    adminAccountIds: z.array(z.uuid()),
    projectRoles: z
      .record(z.string(), appRoleSchema)
      .describe("project id → caller's project role"),
    projectAccounts: z.record(z.string(), z.uuid()).describe("visible project id → account id"),
  })
  .meta({ id: "AccessSummary" });

export const meSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    emailVerified: z.boolean(),
    fullName: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    jobTitle: z.string().nullable(),
    timezone: z.string(),
  })
  .meta({ id: "Me" });
