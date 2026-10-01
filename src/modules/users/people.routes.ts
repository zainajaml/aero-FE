import { z } from "zod";
import { db } from "../../database/client.js";
import { defineRoute } from "../../shared/http/route.js";
import { isSuperAdmin } from "../access/access.policy.js";
import { listVisibleProfiles } from "./people.repository.js";

export const personSchema = z
  .object({
    id: z.uuid(),
    fullName: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    jobTitle: z.string().nullable(),
  })
  .meta({ id: "Person" });

const idsQuery = z.object({
  ids: z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(z.uuid()).max(500))
    .describe("Comma-separated user ids"),
});

export const peopleRoutes = [
  defineRoute({
    method: "get",
    path: "/people",
    operationId: "listVisiblePeople",
    summary:
      "Names and avatars for the given users, limited to people the caller shares a project or account with",
    tags: ["people"],
    request: { query: idsQuery },
    response: { status: 200, schema: z.array(personSchema) },
    handler: ({ actor, query }) =>
      listVisibleProfiles(db, actor.userId, isSuperAdmin(actor), query.ids),
  }),
];
