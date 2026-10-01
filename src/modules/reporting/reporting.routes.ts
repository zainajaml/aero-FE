import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import * as service from "./reporting.service.js";

const tags = ["reporting"];
/** Repeatable id filters arrive as `a,b,c`. */
const idList = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(",").filter(Boolean) : undefined))
  .pipe(z.array(z.uuid()).max(500).optional());
const instant = z.iso
  .datetime({ offset: true })
  .optional()
  .transform((value) => (value ? new Date(value) : undefined));

const workLogRow = z
  .object({
    id: z.uuid(),
    ticketId: z.uuid(),
    projectId: z.uuid(),
    userId: z.uuid(),
    minutes: z.number().int(),
    loggedAt: z.iso.datetime(),
    note: z.string().nullable(),
    resourceType: z.string().nullable(),
  })
  .meta({ id: "WorkLogEntry" });
const ticketRow = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    sprintId: z.uuid().nullable(),
    columnId: z.uuid().nullable(),
    code: z.string(),
    title: z.string(),
    type: z.string(),
    priority: z.string(),
    assigneeId: z.uuid().nullable(),
    estimateMinutes: z.number().int(),
    dueDate: z.string().nullable(),
    updatedAt: z.iso.datetime(),
    stageName: z.string().nullable(),
    isDone: z.boolean(),
  })
  .meta({ id: "TicketReportRow" });
const sprintRow = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    goal: z.string().nullable(),
    status: z.string(),
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    position: z.number(),
  })
  .meta({ id: "SprintReportRow" });

export const reportingRoutes = [
  defineRoute({
    method: "get",
    path: "/reports/work-logs",
    operationId: "listWorkLogEntries",
    summary: "Work logs across visible projects, filtered; ordered by time",
    tags,
    request: {
      query: z.object({
        projectIds: idList,
        sprintIds: idList,
        ticketIds: idList,
        userIds: idList,
        from: instant,
        to: instant,
      }),
    },
    response: { status: 200, schema: z.array(workLogRow) },
    handler: ({ actor, query }) => service.workLogs(actor, query),
  }),
  defineRoute({
    method: "get",
    path: "/reports/tickets",
    operationId: "searchReportTickets",
    summary: "Tickets across visible projects with stage name and done flag",
    tags,
    request: {
      query: z.object({ projectIds: idList, sprintIds: idList, assigneeIds: idList, ids: idList }),
    },
    response: { status: 200, schema: z.array(ticketRow) },
    handler: ({ actor, query }) => service.tickets(actor, query),
  }),
  defineRoute({
    method: "get",
    path: "/reports/sprints",
    operationId: "searchReportSprints",
    summary: "Sprints across visible projects (e.g. completed ones for release notes)",
    tags,
    request: {
      query: z.object({
        projectIds: idList,
        statuses: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(",") : undefined))
          .pipe(z.array(z.enum(["planned", "active", "completed"])).optional()),
      }),
    },
    response: { status: 200, schema: z.array(sprintRow) },
    handler: ({ actor, query }) => service.sprints(actor, query),
  }),
  defineRoute({
    method: "get",
    path: "/reports/reportable-users",
    operationId: "listReportableUsers",
    summary: "People the caller may report on (self plus members of administered projects)",
    tags,
    request: { query: z.object({ projectIds: idList }) },
    response: {
      status: 200,
      schema: z.array(
        z
          .object({ id: z.uuid(), displayName: z.string(), avatarUrl: z.string().nullable() })
          .meta({ id: "ReportableUser" }),
      ),
    },
    handler: ({ actor, query }) => service.reportableUsers(actor, query.projectIds ?? []),
  }),
  defineRoute({
    method: "get",
    path: "/projects/:projectId/rag-report",
    operationId: "getRagReport",
    summary: "RAG status of tickets in the active sprints",
    tags,
    request: { params: z.object({ projectId: z.uuid() }) },
    response: {
      status: 200,
      schema: z
        .object({
          sprints: z.array(z.object({ id: z.uuid(), name: z.string() })),
          counts: z.object({
            red: z.number().int(),
            orange: z.number().int(),
            green: z.number().int(),
          }),
          rows: z.array(
            z.object({
              ticketId: z.uuid(),
              code: z.string(),
              title: z.string(),
              stageName: z.string(),
              estimateMinutes: z.number().int(),
              loggedMinutes: z.number().int(),
              pctSpent: z.number(),
              commentCount: z.number().int(),
              commentOrange: z.boolean(),
              hoursOrange: z.boolean(),
              status: z.enum(["red", "orange", "green"]),
            }),
          ),
        })
        .meta({ id: "RagReport" }),
    },
    errors: [404],
    handler: ({ actor, params }) => service.ragReport(actor, params.projectId),
  }),
  defineRoute({
    method: "post",
    path: "/tickets/:ticketId/comment-summary",
    operationId: "summarizeTicketComments",
    summary: "AI summary of the ticket's comments (issue, solution, next steps)",
    tags,
    request: { params: z.object({ ticketId: z.uuid() }) },
    response: {
      status: 200,
      schema: z
        .object({
          issue: z.array(z.string()),
          solution: z.array(z.string()),
          nextSteps: z.array(z.string()),
        })
        .meta({ id: "CommentSummary" }),
    },
    errors: [404, 429, 502, 503],
    handler: ({ actor, params }) => service.commentSummary(actor, params.ticketId),
  }),
  defineRoute({
    method: "get",
    path: "/projects/:projectId/utilization",
    operationId: "getUtilization",
    summary: "Team utilisation for [from, to) against 40h/week prorated capacity",
    tags,
    request: {
      params: z.object({ projectId: z.uuid() }),
      query: z.object({
        from: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
        to: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
      }),
    },
    response: {
      status: 200,
      schema: z
        .object({
          capacityMinutesPerMember: z.number().int(),
          team: z.object({ loggedMinutes: z.number().int(), utilization: z.number() }),
          members: z.array(
            z.object({
              userId: z.uuid(),
              displayName: z.string(),
              avatarUrl: z.string().nullable(),
              jobTitle: z.string().nullable(),
              role: z.string(),
              projectRole: z.string().nullable(),
              openTicketCount: z.number().int(),
              loggedMinutes: z.number().int(),
              utilization: z.number(),
              tickets: z.array(
                z.object({ ticketId: z.uuid(), code: z.string(), minutes: z.number().int() }),
              ),
            }),
          ),
          logs: z.array(
            z.object({ userId: z.uuid(), minutes: z.number().int(), loggedAt: z.iso.datetime() }),
          ),
        })
        .meta({ id: "Utilization" }),
    },
    errors: [404],
    handler: ({ actor, params, query }) =>
      service.utilization(actor, params.projectId, query.from, query.to),
  }),
];
