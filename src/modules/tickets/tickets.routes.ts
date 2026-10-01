import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import { MB, singleFile } from "../files/upload.js";
import * as comments from "../comments/comments.service.js";
import * as worklogs from "../worklogs/worklogs.service.js";
import * as attachments from "./attachments.service.js";
import * as estimates from "./estimates.service.js";
import * as s from "./tickets.schemas.js";
import * as service from "./tickets.service.js";

const tags = ["tickets"];
const estimateParams = z.object({ ticketId: z.uuid(), estimateId: z.uuid() });
const workLogParams = z.object({ ticketId: z.uuid(), workLogId: z.uuid() });
const commentParams = z.object({ ticketId: z.uuid(), commentId: z.uuid() });
const attachmentParams = z.object({ ticketId: z.uuid(), attachmentId: z.uuid() });

export const ticketRoutes = [
  defineRoute({
    method: "get",
    path: "/projects/:projectId/tickets",
    operationId: "listTickets",
    summary: "All tickets of a project with logged minutes and epic ids",
    tags,
    request: { params: s.projectParams },
    response: { status: 200, schema: z.array(s.ticketSummarySchema) },
    errors: [404],
    handler: ({ actor, params }) => service.listTickets(actor, params.projectId),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/tickets",
    operationId: "createTicket",
    summary:
      "Create a ticket (code, position, stage history, epics and estimates in one transaction)",
    tags,
    request: { params: s.projectParams, body: s.createTicketBody },
    response: { status: 201, schema: s.ticketSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.createTicket(actor, params.projectId, body),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/tickets/bulk-move",
    operationId: "bulkMoveTickets",
    summary: "Move tickets to a sprint or the backlog",
    tags,
    request: { params: s.projectParams, body: s.bulkMoveBody },
    response: { status: 200, schema: z.object({ updated: z.number().int() }) },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      service.bulkMoveTickets(actor, params.projectId, body.ticketIds, body.sprintId),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/tickets/bulk-update",
    operationId: "bulkUpdateTickets",
    summary: "Bulk edit fields and add epics",
    tags,
    request: { params: s.projectParams, body: s.bulkUpdateBody },
    response: { status: 200, schema: z.object({ updated: z.number().int() }) },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.bulkUpdateTickets(actor, params.projectId, body),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/tickets/bulk-delete",
    operationId: "bulkDeleteTickets",
    summary:
      "Delete tickets without logged time outside completed sprints; others are reported as skipped",
    tags,
    request: { params: s.projectParams, body: s.bulkDeleteBody },
    response: { status: 200, schema: s.bulkDeleteResult },
    errors: [403, 404],
    handler: ({ actor, params, body }) =>
      service.bulkDeleteTickets(actor, params.projectId, body.ticketIds),
  }),
  defineRoute({
    method: "get",
    path: "/projects/:projectId/ticket-estimates",
    operationId: "listProjectEstimates",
    summary: "Estimate rows of every ticket in a project (cost reporting)",
    tags,
    request: { params: s.projectParams },
    response: {
      status: 200,
      schema: z.array(
        z
          .object({ ticketId: z.uuid(), resourceType: z.string(), minutes: z.number().int() })
          .meta({ id: "ProjectEstimate" }),
      ),
    },
    errors: [404],
    handler: ({ actor, params }) => service.listProjectEstimates(actor, params.projectId),
  }),
  defineRoute({
    method: "get",
    path: "/projects/:projectId/stage-history",
    operationId: "listStageHistory",
    summary: "Column transitions of the project's tickets, oldest first",
    tags,
    request: { params: s.projectParams },
    response: {
      status: 200,
      schema: z.array(
        z
          .object({
            id: z.uuid(),
            ticketId: z.uuid(),
            columnId: z.uuid().nullable(),
            columnName: z.string(),
            enteredAt: z.iso.datetime(),
            movedBy: z.uuid().nullable(),
          })
          .meta({ id: "StageTransition" }),
      ),
    },
    errors: [404],
    handler: ({ actor, params }) => service.listStageHistory(actor, params.projectId),
  }),
  defineRoute({
    method: "get",
    path: "/tickets/:ticketId",
    operationId: "getTicket",
    summary: "A ticket with its description",
    tags,
    request: { params: s.ticketParams },
    response: { status: 200, schema: s.ticketSchema },
    errors: [404],
    handler: ({ actor, params }) => service.getTicket(actor, params.ticketId),
  }),
  defineRoute({
    method: "patch",
    path: "/tickets/:ticketId",
    operationId: "updateTicket",
    summary: "Save ticket fields, stage and epics in one transaction",
    tags,
    request: { params: s.ticketParams, body: s.updateTicketBody },
    response: { status: 200, schema: s.ticketSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.updateTicket(actor, params.ticketId, body),
  }),
  defineRoute({
    method: "post",
    path: "/tickets/:ticketId/move",
    operationId: "moveTicket",
    summary: "Move a ticket between sprints/columns and reorder it",
    tags,
    request: { params: s.ticketParams, body: s.moveTicketBody },
    response: { status: 200, schema: s.ticketSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.moveTicket(actor, params.ticketId, body),
  }),
  defineRoute({
    method: "put",
    path: "/tickets/:ticketId/epics",
    operationId: "setTicketEpics",
    summary: "Replace the ticket's epics",
    tags,
    request: {
      params: s.ticketParams,
      body: z.object({ epicIds: z.array(z.uuid()).max(50) }).meta({ id: "SetTicketEpicsRequest" }),
    },
    response: { status: 200, schema: s.ticketSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      service.setTicketEpics(actor, params.ticketId, body.epicIds),
  }),
  defineRoute({
    method: "delete",
    path: "/tickets/:ticketId",
    operationId: "deleteTicket",
    summary: "Delete a ticket without logged time (project managers)",
    tags,
    request: { params: s.ticketParams },
    response: { status: 204 },
    errors: [403, 404, 409],
    handler: ({ actor, params }) => service.deleteTicket(actor, params.ticketId),
  }),

  // Estimates
  defineRoute({
    method: "get",
    path: "/tickets/:ticketId/estimates",
    operationId: "listEstimates",
    summary: "Estimate rows of a ticket",
    tags,
    request: { params: s.ticketParams },
    response: { status: 200, schema: z.array(s.estimateSchema) },
    errors: [404],
    handler: ({ actor, params }) => estimates.listEstimates(actor, params.ticketId),
  }),
  defineRoute({
    method: "post",
    path: "/tickets/:ticketId/estimates",
    operationId: "addEstimate",
    summary: "Add an estimate (ticket total stays in sync)",
    tags,
    request: { params: s.ticketParams, body: s.addEstimateBody },
    response: { status: 201, schema: s.estimateSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => estimates.addEstimate(actor, params.ticketId, body),
  }),
  defineRoute({
    method: "patch",
    path: "/tickets/:ticketId/estimates/:estimateId",
    operationId: "updateEstimate",
    summary: "Change an estimate (project managers)",
    tags,
    request: { params: estimateParams, body: s.updateEstimateBody },
    response: { status: 200, schema: s.estimateSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      estimates.updateEstimate(actor, params.ticketId, params.estimateId, body),
  }),
  defineRoute({
    method: "delete",
    path: "/tickets/:ticketId/estimates/:estimateId",
    operationId: "deleteEstimate",
    summary: "Remove an estimate (project managers)",
    tags,
    request: { params: estimateParams },
    response: { status: 204 },
    errors: [403, 404, 409],
    handler: ({ actor, params }) =>
      estimates.deleteEstimate(actor, params.ticketId, params.estimateId),
  }),

  // Work logs
  defineRoute({
    method: "get",
    path: "/tickets/:ticketId/work-logs",
    operationId: "listWorkLogs",
    summary: "Time logged on a ticket, newest first",
    tags,
    request: { params: s.ticketParams },
    response: { status: 200, schema: z.array(s.workLogSchema) },
    errors: [404],
    handler: ({ actor, params }) => worklogs.listWorkLogs(actor, params.ticketId),
  }),
  defineRoute({
    method: "post",
    path: "/tickets/:ticketId/work-logs",
    operationId: "addWorkLog",
    summary: "Log time (managers may log for others)",
    tags,
    request: { params: s.ticketParams, body: s.addWorkLogBody },
    response: { status: 201, schema: s.workLogSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => worklogs.addWorkLog(actor, params.ticketId, body),
  }),
  defineRoute({
    method: "patch",
    path: "/tickets/:ticketId/work-logs/:workLogId",
    operationId: "updateWorkLog",
    summary: "Change a work log (owner or manager)",
    tags,
    request: { params: workLogParams, body: s.updateWorkLogBody },
    response: { status: 200, schema: s.workLogSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      worklogs.updateWorkLog(actor, params.ticketId, params.workLogId, body),
  }),
  defineRoute({
    method: "delete",
    path: "/tickets/:ticketId/work-logs/:workLogId",
    operationId: "deleteWorkLog",
    summary: "Remove a work log (owner or manager)",
    tags,
    request: { params: workLogParams },
    response: { status: 204 },
    errors: [403, 404, 409],
    handler: ({ actor, params }) =>
      worklogs.deleteWorkLog(actor, params.ticketId, params.workLogId),
  }),

  // Comments
  defineRoute({
    method: "get",
    path: "/tickets/:ticketId/comments",
    operationId: "listComments",
    summary: "Comments of a ticket, oldest first",
    tags,
    request: { params: s.ticketParams },
    response: { status: 200, schema: z.array(s.commentSchema) },
    errors: [404],
    handler: ({ actor, params }) => comments.listComments(actor, params.ticketId),
  }),
  defineRoute({
    method: "post",
    path: "/tickets/:ticketId/comments",
    operationId: "addComment",
    summary: "Comment or reply (mentions and reply authors are emailed)",
    tags,
    request: { params: s.ticketParams, body: s.addCommentBody },
    response: { status: 201, schema: s.commentSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => comments.addComment(actor, params.ticketId, body),
  }),
  defineRoute({
    method: "patch",
    path: "/tickets/:ticketId/comments/:commentId",
    operationId: "editComment",
    summary: "Edit your comment",
    tags,
    request: { params: commentParams, body: s.editCommentBody },
    response: { status: 200, schema: s.commentSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      comments.editComment(actor, params.ticketId, params.commentId, body.body),
  }),
  defineRoute({
    method: "delete",
    path: "/tickets/:ticketId/comments/:commentId",
    operationId: "deleteComment",
    summary: "Delete a comment (author or manager) with its replies and files",
    tags,
    request: { params: commentParams },
    response: { status: 204 },
    errors: [403, 404, 409],
    handler: ({ actor, params }) =>
      comments.deleteComment(actor, params.ticketId, params.commentId),
  }),

  // Attachments
  defineRoute({
    method: "get",
    path: "/tickets/:ticketId/attachments",
    operationId: "listAttachments",
    summary: "Files attached to a ticket or its comments",
    tags,
    request: { params: s.ticketParams },
    response: { status: 200, schema: z.array(s.attachmentSchema) },
    errors: [404],
    handler: ({ actor, params }) => attachments.listAttachments(actor, params.ticketId),
  }),
  defineRoute({
    method: "post",
    path: "/tickets/:ticketId/attachments",
    operationId: "uploadAttachment",
    summary:
      "Attach a file (multipart field `file`, max 25 MB); `commentId` query attaches it to your comment",
    tags,
    request: { params: s.ticketParams, query: z.object({ commentId: z.uuid().optional() }) },
    middleware: [singleFile(25 * MB)],
    upload: { description: "Any file, max 25 MB" },
    response: { status: 201, schema: s.attachmentSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, query, req }) =>
      attachments.uploadAttachment(actor, params.ticketId, req.file, query.commentId ?? null),
  }),
  defineRoute({
    method: "get",
    path: "/tickets/:ticketId/attachments/:attachmentId/url",
    operationId: "getAttachmentUrl",
    summary: "Short-lived download URL",
    tags,
    request: { params: attachmentParams },
    response: { status: 200, schema: z.object({ url: z.string() }).meta({ id: "DownloadUrl" }) },
    errors: [404],
    handler: ({ actor, params }) =>
      attachments.attachmentUrl(actor, params.ticketId, params.attachmentId),
  }),
  defineRoute({
    method: "delete",
    path: "/tickets/:ticketId/attachments/:attachmentId",
    operationId: "deleteAttachment",
    summary: "Remove a file (uploader or manager)",
    tags,
    request: { params: attachmentParams },
    response: { status: 204 },
    errors: [403, 404, 409],
    handler: ({ actor, params }) =>
      attachments.deleteAttachment(actor, params.ticketId, params.attachmentId),
  }),
];
