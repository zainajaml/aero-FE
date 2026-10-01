import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import { MB, singleFile } from "../files/upload.js";
import * as service from "./support.service.js";

const tags = ["support"];
const issueSchema = z
  .object({
    id: z.uuid(),
    ticketNumber: z.string(),
    subject: z.string(),
    status: z.enum(["open", "closed"]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    owner: z.object({ id: z.uuid(), name: z.string(), avatarUrl: z.string().nullable() }),
  })
  .meta({ id: "SupportIssue" });
const issueParams = z.object({ issueId: z.uuid() });
const messageBody = z.string().max(200_000).describe("Serialized TipTap JSON or text");

export const supportRoutes = [
  defineRoute({
    method: "get",
    path: "/support/issues",
    operationId: "listSupportIssues",
    summary: "Your tickets (super admins: all tickets)",
    tags,
    request: {
      query: z.object({
        status: z.enum(["open", "closed"]).optional(),
        sort: z.enum(["asc", "desc"]).default("desc"),
      }),
    },
    response: { status: 200, schema: z.array(issueSchema) },
    handler: ({ actor, query }) =>
      service.listIssues(actor, { status: query.status, ascending: query.sort === "asc" }),
  }),
  defineRoute({
    method: "get",
    path: "/support/open-count",
    operationId: "countOpenSupportIssues",
    summary: "Number of open tickets in the caller's view",
    tags,
    response: {
      status: 200,
      schema: z.object({ count: z.number().int() }).meta({ id: "SupportOpenCount" }),
    },
    handler: ({ actor }) => service.openCount(actor),
  }),
  defineRoute({
    method: "post",
    path: "/support/issues",
    operationId: "createSupportIssue",
    summary: "Open a ticket with an optional first message",
    tags,
    request: {
      body: z
        .object({
          subject: z.string().trim().min(1, "Subject is required").max(100),
          description: messageBody.nullish(),
        })
        .meta({ id: "CreateSupportIssueRequest" }),
    },
    response: {
      status: 201,
      schema: z
        .object({ issue: issueSchema, messageId: z.uuid().nullable() })
        .meta({ id: "CreateSupportIssueResult" }),
    },
    handler: ({ actor, body }) => service.createIssue(actor, body),
  }),
  defineRoute({
    method: "get",
    path: "/support/issues/:issueId",
    operationId: "getSupportIssue",
    summary: "A ticket with its messages",
    tags,
    request: { params: issueParams },
    response: {
      status: 200,
      schema: z
        .object({
          issue: issueSchema,
          messages: z.array(
            z.object({
              id: z.uuid(),
              authorId: z.uuid(),
              author: z.object({ name: z.string(), avatarUrl: z.string().nullable() }),
              body: z.string(),
              attachmentKey: z.string().nullable().describe("Sign with area `support`"),
              createdAt: z.iso.datetime(),
              editedAt: z.iso.datetime().nullable(),
              canEdit: z.boolean(),
            }),
          ),
        })
        .meta({ id: "SupportIssueDetail" }),
    },
    errors: [404],
    handler: ({ actor, params }) => service.getIssue(actor, params.issueId),
  }),
  defineRoute({
    method: "post",
    path: "/support/issues/:issueId/messages",
    operationId: "postSupportMessage",
    summary: "Post a message (multipart: `body` text field, optional `file` image/video max 25 MB)",
    tags,
    request: { params: issueParams, body: z.object({ body: messageBody.default("") }) },
    middleware: [singleFile(25 * MB)],
    upload: { description: "Fields: body (text), file (optional image or video, max 25 MB)" },
    response: {
      status: 201,
      schema: z
        .object({ id: z.uuid(), createdAt: z.iso.datetime(), attachmentKey: z.string().nullable() })
        .meta({ id: "SupportMessagePosted" }),
    },
    errors: [404],
    handler: ({ actor, params, body, req }) =>
      service.postMessage(actor, params.issueId, body.body, req.file),
  }),
  defineRoute({
    method: "patch",
    path: "/support/issues/:issueId/messages/:messageId",
    operationId: "editSupportMessage",
    summary: "Edit your message while the ticket is open",
    tags,
    request: {
      params: z.object({ issueId: z.uuid(), messageId: z.uuid() }),
      body: z.object({ body: messageBody }).meta({ id: "EditSupportMessageRequest" }),
    },
    response: { status: 200, schema: z.object({ id: z.uuid(), editedAt: z.iso.datetime() }) },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      service.editMessage(actor, params.issueId, params.messageId, body.body),
  }),
  defineRoute({
    method: "patch",
    path: "/support/issues/:issueId",
    operationId: "setSupportIssueStatus",
    summary: "Close or reopen a ticket",
    tags,
    request: {
      params: issueParams,
      body: z
        .object({ status: z.enum(["open", "closed"]) })
        .meta({ id: "SetSupportIssueStatusRequest" }),
    },
    response: { status: 200, schema: issueSchema },
    errors: [404],
    handler: ({ actor, params, body }) => service.setStatus(actor, params.issueId, body.status),
  }),
  defineRoute({
    method: "delete",
    path: "/support/issues/:issueId",
    operationId: "deleteSupportIssue",
    summary: "Delete a ticket, its messages and files",
    tags,
    request: { params: issueParams },
    response: { status: 204 },
    errors: [404],
    handler: ({ actor, params }) => service.deleteIssue(actor, params.issueId),
  }),
];
