import { z } from "zod";
import { APP_ROLES } from "../../database/schema/_shared.js";
import { defineRoute } from "../../shared/http/route.js";
import * as access from "./users.access.js";
import { listOrgUsers } from "./users.listing.js";

const tags = ["admin"];
const userParams = z.object({ userId: z.uuid() });
const role = z.enum(APP_ROLES);

const orgUser = z
  .object({
    id: z.uuid(),
    email: z.string().nullable(),
    fullName: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    jobTitle: z.string().nullable(),
    createdAt: z.iso.datetime(),
    role: role.nullable(),
    projectIds: z.array(z.uuid()),
    accountIds: z.array(z.uuid()),
    archivedAt: z.iso.datetime().nullable(),
    hasActivity: z.boolean(),
    emailHidden: z.boolean(),
  })
  .meta({ id: "OrgUser" });

export const adminRoutes = [
  defineRoute({
    method: "get",
    path: "/admin/users",
    operationId: "listOrgUsers",
    summary: "User management view clipped to the open account/project",
    tags,
    request: {
      query: z.object({ accountId: z.uuid().optional(), projectId: z.uuid().optional() }),
    },
    response: {
      status: 200,
      schema: z
        .object({
          users: z.array(orgUser),
          invitations: z.array(
            z.object({
              id: z.uuid(),
              email: z.string(),
              role,
              projectIds: z.array(z.uuid()),
              accountIds: z.array(z.uuid()),
              jobTitle: z.string().nullable(),
              invitedBy: z.uuid().nullable(),
              createdAt: z.iso.datetime(),
              expiresAt: z.iso.datetime(),
            }),
          ),
          projects: z.array(
            z.object({ id: z.uuid(), name: z.string(), key: z.string(), accountId: z.uuid() }),
          ),
          accounts: z.array(z.object({ id: z.uuid(), name: z.string() })),
          scope: z.object({
            isGlobalAdmin: z.boolean(),
            isAccountAdmin: z.boolean(),
            isClientAdmin: z.boolean(),
            contextScoped: z.boolean(),
            contextIsAccountAdmin: z.boolean(),
            contextIsProjectAdmin: z.boolean(),
            inviteLimit: z.number().int().nullable(),
            invitesUsed: z.number().int(),
          }),
        })
        .meta({ id: "OrgUserList" }),
    },
    errors: [403],
    handler: ({ actor, query }) => listOrgUsers(actor, query),
  }),
  defineRoute({
    method: "put",
    path: "/admin/users/:userId/access",
    operationId: "updateUserAccess",
    summary: "Change a user's role, projects/accounts and profile fields",
    tags,
    request: {
      params: userParams,
      body: z
        .object({
          role,
          projectIds: z.array(z.uuid()).max(50).nullish(),
          accountIds: z.array(z.uuid()).max(50).nullish(),
          jobTitle: z.string().trim().max(120).nullish(),
          firstName: z.string().trim().max(80).nullish(),
          lastName: z.string().trim().max(80).nullish(),
          contextAccountId: z.uuid().nullish(),
          contextProjectId: z.uuid().nullish(),
        })
        .meta({ id: "UpdateUserAccessRequest" }),
    },
    response: { status: 200, schema: z.object({ ok: z.literal(true) }) },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => access.updateUserAccess(actor, params.userId, body),
  }),
  defineRoute({
    method: "delete",
    path: "/admin/users/:userId/access",
    operationId: "removeUserAccess",
    summary:
      "Remove access (one project, or everything in the caller's scope); super admins may delete unused identities",
    tags,
    request: { params: userParams, query: z.object({ projectId: z.uuid().optional() }) },
    response: {
      status: 200,
      schema: z
        .object({
          deleted: z.boolean(),
          removedProjects: z.number().int(),
          hasRemainingAccess: z.boolean(),
        })
        .meta({ id: "RemoveUserAccessResult" }),
    },
    errors: [403, 409],
    handler: ({ actor, params, query }) =>
      access.removeAccess(actor, params.userId, query.projectId ?? null),
  }),
  defineRoute({
    method: "get",
    path: "/admin/users/:userId/open-tickets",
    operationId: "listUserOpenTickets",
    summary: "Open tickets assigned to a user and possible new assignees",
    tags,
    request: { params: userParams },
    response: {
      status: 200,
      schema: z
        .object({
          tickets: z.array(
            z.object({
              id: z.uuid(),
              code: z.string(),
              title: z.string(),
              projectId: z.uuid(),
              projectName: z.string(),
            }),
          ),
          singleProjectId: z.uuid().nullable(),
          candidates: z.array(z.object({ id: z.uuid(), name: z.string() })),
        })
        .meta({ id: "UserOpenTickets" }),
    },
    errors: [403],
    handler: ({ actor, params }) => access.openTickets(actor, params.userId),
  }),
  defineRoute({
    method: "post",
    path: "/admin/users/:userId/reassign-tickets",
    operationId: "reassignUserTickets",
    summary: "Reassign a user's open tickets (null = unassigned)",
    tags,
    request: {
      params: userParams,
      body: z.object({ assigneeId: z.uuid().nullable() }).meta({ id: "ReassignTicketsRequest" }),
    },
    response: { status: 200, schema: z.object({ reassignedTickets: z.number().int() }) },
    errors: [400, 403],
    handler: ({ actor, params, body }) =>
      access.reassignOpenTickets(actor, params.userId, body.assigneeId),
  }),
  defineRoute({
    method: "post",
    path: "/admin/users/:userId/archive",
    operationId: "archiveUser",
    summary: "Archive an identity (super admins), optionally reassigning open tickets",
    tags,
    request: {
      params: userParams,
      body: z
        .object({ reassign: z.object({ assigneeId: z.uuid().nullable() }).optional() })
        .meta({ id: "ArchiveUserRequest" }),
    },
    response: {
      status: 200,
      schema: z
        .object({ archived: z.boolean(), reassignedTickets: z.number().int() })
        .meta({ id: "ArchiveUserResult" }),
    },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => access.archiveUser(actor, params.userId, body.reassign),
  }),
  defineRoute({
    method: "post",
    path: "/admin/users/:userId/restore",
    operationId: "restoreUser",
    summary: "Restore an archived identity (super admins)",
    tags,
    request: { params: userParams },
    response: {
      status: 200,
      schema: z.object({ archived: z.boolean(), reassignedTickets: z.number().int() }),
    },
    errors: [403, 404],
    handler: ({ actor, params }) => access.restoreUser(actor, params.userId),
  }),
  defineRoute({
    method: "put",
    path: "/admin/users/:userId/email",
    operationId: "setImportedUserEmail",
    summary: "Set the real email of a Jira-imported placeholder identity",
    tags,
    request: {
      params: userParams,
      body: z
        .object({ email: z.string().trim().max(320).pipe(z.email("Enter a valid email address.")) })
        .meta({ id: "SetImportedEmailRequest" }),
    },
    response: { status: 200, schema: z.object({ email: z.string() }) },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => access.setImportedEmail(actor, params.userId, body.email),
  }),
];
