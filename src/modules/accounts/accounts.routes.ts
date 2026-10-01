import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import * as service from "./accounts.service.js";

const tags = ["accounts"];

const accountSchema = z
  .object({ id: z.uuid(), name: z.string(), slug: z.string(), createdAt: z.iso.datetime() })
  .meta({ id: "Account" });
const accountIdParams = z.object({ accountId: z.uuid() });
const name = z.string().trim().min(1, "Name required").max(120, "That name is too long");
const slug = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9_-]+$/, "Slug may only contain letters, numbers, - and _");

const projectSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  key: z.string(),
  projectType: z.string(),
  createdAt: z.iso.datetime(),
  members: z.number().int(),
  sprints: z.number().int(),
  tickets: z.number().int(),
});

export const accountRoutes = [
  defineRoute({
    method: "get",
    path: "/accounts",
    operationId: "listAccounts",
    summary: "Accounts visible to the caller (administered or containing one of their projects)",
    tags,
    response: { status: 200, schema: z.array(accountSchema) },
    handler: ({ actor }) => service.listVisibleAccounts(actor),
  }),
  defineRoute({
    method: "get",
    path: "/accounts/administered",
    operationId: "listAdministeredAccounts",
    summary: "Accounts the caller administers, with their projects",
    tags,
    response: {
      status: 200,
      schema: z.array(
        accountSchema
          .extend({
            projects: z.array(z.object({ id: z.uuid(), name: z.string(), key: z.string() })),
          })
          .meta({ id: "AdministeredAccount" }),
      ),
    },
    errors: [403],
    handler: ({ actor }) => service.listAdministeredAccounts(actor),
  }),
  defineRoute({
    method: "post",
    path: "/accounts",
    operationId: "createAccount",
    summary: "Create an account (account admins and super admins)",
    tags,
    request: {
      body: z.object({ name, slug: slug.nullish() }).meta({ id: "CreateAccountRequest" }),
    },
    response: { status: 201, schema: accountSchema },
    errors: [403, 409],
    handler: ({ actor, body }) => service.createAccount(actor, body),
  }),
  defineRoute({
    method: "patch",
    path: "/accounts/:accountId",
    operationId: "updateAccount",
    summary: "Rename an account or change its slug",
    tags,
    request: {
      params: accountIdParams,
      body: z
        .object({ name: name.optional(), slug: slug.optional() })
        .meta({ id: "UpdateAccountRequest" }),
    },
    response: { status: 200, schema: accountSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.updateAccount(actor, params.accountId, body),
  }),
  defineRoute({
    method: "delete",
    path: "/accounts/:accountId",
    operationId: "deleteAccount",
    summary: "Delete an account; `force=true` also deletes its projects",
    tags,
    request: {
      params: accountIdParams,
      query: z.object({
        force: z
          .enum(["true", "false"])
          .optional()
          .transform((v) => v === "true"),
      }),
    },
    response: {
      status: 200,
      schema: z.object({ deletedProjects: z.number().int() }).meta({ id: "DeleteAccountResult" }),
    },
    errors: [403, 404, 409],
    handler: ({ actor, params, query }) =>
      service.deleteAccount(actor, params.accountId, query.force),
  }),
  defineRoute({
    method: "get",
    path: "/me/workspace",
    operationId: "getMyWorkspace",
    summary: "Accounts the caller administers and their other project memberships, with counts",
    tags: ["me"],
    response: {
      status: 200,
      schema: z
        .object({
          accounts: z.array(accountSchema.extend({ projects: z.array(projectSummary) })),
          projects: z.array(
            projectSummary.extend({
              role: z.string(),
              accountId: z.uuid(),
              accountName: z.string(),
            }),
          ),
        })
        .meta({ id: "MyWorkspace" }),
    },
    handler: ({ actor }) => service.getMyWorkspace(actor),
  }),
];
