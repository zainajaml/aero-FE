import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import { listAuditLogs } from "./audit.viewer.js";

export const auditRoutes = [
  defineRoute({
    method: "get",
    path: "/audit-logs",
    operationId: "listAuditLogs",
    summary: "Audit trail visible to the caller (admins), paged and sortable",
    tags: ["audit"],
    request: {
      query: z.object({
        projectId: z.uuid().optional(),
        userId: z.uuid().optional(),
        q: z.string().max(200).optional(),
        sort: z
          .enum(["createdAt", "action", "table", "field", "value", "user", "project", "account"])
          .default("createdAt"),
        dir: z.enum(["asc", "desc"]).default("desc"),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce
          .number()
          .int()
          .refine((n) => [50, 100, 200].includes(n), "Use 50, 100 or 200")
          .default(50),
      }),
    },
    response: {
      status: 200,
      schema: z
        .object({
          items: z.array(
            z.object({
              id: z.uuid(),
              createdAt: z.iso.datetime(),
              action: z.string(),
              tableName: z.string().nullable(),
              field: z.string().nullable(),
              value: z.string().nullable(),
              link: z.string().nullable(),
              userId: z.uuid(),
              userName: z.string(),
              projectId: z.uuid().nullable(),
              projectName: z.string().nullable(),
              accountId: z.uuid().nullable(),
              accountName: z.string().nullable(),
            }),
          ),
          total: z.number().int(),
          page: z.number().int(),
          pageSize: z.number().int(),
        })
        .meta({ id: "AuditLogPage" }),
    },
    errors: [403],
    handler: ({ actor, query }) => listAuditLogs(actor, query),
  }),
];
