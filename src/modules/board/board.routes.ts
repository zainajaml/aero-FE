import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import * as service from "./board.service.js";

const tags = ["board"];
const columnSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    orderIndex: z.number().int(),
    isDone: z.boolean(),
  })
  .meta({ id: "BoardColumn" });
const projectParams = z.object({ projectId: z.uuid() });
const columnParams = z.object({ projectId: z.uuid(), columnId: z.uuid() });
const columnName = z.string().trim().min(1, "Column name is required").max(60);

export const boardRoutes = [
  defineRoute({
    method: "get",
    path: "/projects/:projectId/columns",
    operationId: "listColumns",
    summary: "Board columns in order",
    tags,
    request: { params: projectParams },
    response: { status: 200, schema: z.array(columnSchema) },
    errors: [404],
    handler: ({ actor, params }) => service.listColumns(actor, params.projectId),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/columns",
    operationId: "addColumn",
    summary: "Add a column at the end (project managers)",
    tags,
    request: {
      params: projectParams,
      body: z.object({ name: columnName }).meta({ id: "AddColumnRequest" }),
    },
    response: { status: 201, schema: columnSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.addColumn(actor, params.projectId, body.name),
  }),
  defineRoute({
    method: "patch",
    path: "/projects/:projectId/columns/:columnId",
    operationId: "updateColumn",
    summary: "Rename a column or toggle its done flag",
    tags,
    request: {
      params: columnParams,
      body: z
        .object({ name: columnName.optional(), isDone: z.boolean().optional() })
        .meta({ id: "UpdateColumnRequest" }),
    },
    response: { status: 200, schema: columnSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      service.updateColumn(actor, params.projectId, params.columnId, body),
  }),
  defineRoute({
    method: "delete",
    path: "/projects/:projectId/columns/:columnId",
    operationId: "deleteColumn",
    summary: "Delete a column (its tickets keep no column)",
    tags,
    request: { params: columnParams },
    response: { status: 204 },
    errors: [403, 404, 409],
    handler: ({ actor, params }) => service.deleteColumn(actor, params.projectId, params.columnId),
  }),
  defineRoute({
    method: "put",
    path: "/projects/:projectId/columns/order",
    operationId: "reorderColumns",
    summary: "Set the order of all columns atomically",
    tags,
    request: {
      params: projectParams,
      body: z
        .object({ columnIds: z.array(z.uuid()).min(1).max(50) })
        .meta({ id: "ReorderColumnsRequest" }),
    },
    response: { status: 200, schema: z.array(columnSchema) },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      service.reorderColumns(actor, params.projectId, body.columnIds),
  }),
];
