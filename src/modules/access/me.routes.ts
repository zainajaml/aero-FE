import { db } from "../../database/client.js";
import { NotFoundError } from "../../shared/http/errors.js";
import { defineRoute } from "../../shared/http/route.js";
import { findProfile } from "../users/profiles.repository.js";
import { getAccessSummary } from "./access.service.js";
import { accessSummarySchema, meSchema } from "./me.schemas.js";

export const meRoutes = [
  defineRoute({
    method: "get",
    path: "/me",
    operationId: "getMe",
    summary: "The signed-in user's identity and profile",
    tags: ["me"],
    response: { status: 200, schema: meSchema },
    errors: [403, 404],
    handler: async ({ actor }) => {
      const profile = await findProfile(db, actor.userId);
      if (!profile) throw new NotFoundError("Profile");
      return {
        id: actor.userId,
        email: actor.email,
        emailVerified: actor.emailVerified,
        fullName: profile.fullName,
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatarUrl: profile.avatarUrl,
        jobTitle: profile.jobTitle,
        timezone: profile.timezone,
      };
    },
  }),
  defineRoute({
    method: "get",
    path: "/me/access",
    operationId: "getMyAccess",
    summary: "Roles, memberships and the app-gate status for the signed-in user",
    tags: ["me"],
    response: { status: 200, schema: accessSummarySchema },
    errors: [403],
    handler: ({ actor }) => getAccessSummary(actor),
  }),
];
