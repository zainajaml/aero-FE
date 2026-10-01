import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import * as service from "./sprints.service.js";

const tags = ["sprints"];
const sprintSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    goal: z.string().nullable(),
    status: z.enum(["planned", "active", "completed"]),
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    position: z.number(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Sprint" });
const projectParams = z.object({ projectId: z.uuid() });
const sprintParams = z.object({ projectId: z.uuid(), sprintId: z.uuid() });
const dateTime = z.iso.datetime({ offset: true }).nullish();
const fields = {
  name: z
    .string()
    .trim()
    .min(1, "Sprint name is required")
    .max(50, "Sprint name must be 50 characters or fewer"),
  goal: z.string().trim().max(250).nullish(),
  startsAt: dateTime,
  endsAt: dateTime,
};

export const sprintRoutes = [
  defineRoute({
    method: "get",
    path: "/projects/:projectId/sprints",
    operationId: "listSprints",
    summary: "Sprints in display order",
    tags,
    request: { params: projectParams },
    response: { status: 200, schema: z.array(sprintSchema) },
    errors: [404],
    handler: ({ actor, params }) => service.listSprints(actor, params.projectId),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/sprints",
    operationId: "createSprint",
    summary: "Create a planned sprint at the top",
    tags,
    request: { params: projectParams, body: z.object(fields).meta({ id: "CreateSprintRequest" }) },
    response: { status: 201, schema: sprintSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.createSprint(actor, params.projectId, body),
  }),
  defineRoute({
    method: "patch",
    path: "/projects/:projectId/sprints/:sprintId",
    operationId: "updateSprint",
    summary: "Edit name, goal or dates",
    tags,
    request: {
      params: sprintParams,
      body: z
        .object({ ...fields, name: fields.name.optional() })
        .meta({ id: "UpdateSprintRequest" }),
    },
    response: { status: 200, schema: sprintSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      service.updateSprint(actor, params.projectId, params.sprintId, body),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/sprints/:sprintId/start",
    operationId: "startSprint",
    summary: "Start a sprint now",
    tags,
    request: { params: sprintParams },
    response: { status: 200, schema: sprintSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params }) => service.startSprint(actor, params.projectId, params.sprintId),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/sprints/:sprintId/complete",
    operationId: "completeSprint",
    summary:
      "Complete a sprint, moving unfinished tickets to the backlog (null) or another open sprint",
    tags,
    request: {
      params: sprintParams,
      body: z
        .object({ moveOpenTicketsTo: z.uuid().nullable() })
        .meta({ id: "CompleteSprintRequest" }),
    },
    response: {
      status: 200,
      schema: z
        .object({ sprint: sprintSchema, movedTicketIds: z.array(z.uuid()) })
        .meta({ id: "CompleteSprintResult" }),
    },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      service.completeSprint(actor, params.projectId, params.sprintId, body.moveOpenTicketsTo),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/sprints/:sprintId/move",
    operationId: "moveSprint",
    summary: "Reorder an unstarted sprint between neighbours",
    tags,
    request: {
      params: sprintParams,
      body: z
        .object({ afterSprintId: z.uuid().nullish(), beforeSprintId: z.uuid().nullish() })
        .meta({ id: "MoveSprintRequest" }),
    },
    response: { status: 200, schema: sprintSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      service.moveSprint(actor, params.projectId, params.sprintId, body),
  }),
  defineRoute({
    method: "delete",
    path: "/projects/:projectId/sprints/:sprintId",
    operationId: "deleteSprint",
    summary: "Delete a sprint; its tickets return to the backlog",
    tags,
    request: { params: sprintParams },
    response: { status: 204 },
    errors: [403, 404, 409],
    handler: ({ actor, params }) => service.deleteSprint(actor, params.projectId, params.sprintId),
  }),
];
