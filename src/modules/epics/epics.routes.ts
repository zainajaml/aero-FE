import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import * as service from "./epics.service.js";

const tags = ["epics"];
const epicSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Epic" });
const projectParams = z.object({ projectId: z.uuid() });
const epicParams = z.object({ projectId: z.uuid(), epicId: z.uuid() });
const nameBody = z
  .object({ name: z.string().trim().min(1, "Epic name is required").max(80) })
  .meta({ id: "EpicNameRequest" });

export const epicRoutes = [
  defineRoute({
    method: "get",
    path: "/projects/:projectId/epics",
    operationId: "listEpics",
    summary: "Epics of a project by name",
    tags,
    request: { params: projectParams },
    response: { status: 200, schema: z.array(epicSchema) },
    errors: [404],
    handler: ({ actor, params }) => service.listEpics(actor, params.projectId),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/epics",
    operationId: "createEpic",
    summary: "Create an epic (unique name per project)",
    tags,
    request: { params: projectParams, body: nameBody },
    response: { status: 201, schema: epicSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.createEpic(actor, params.projectId, body.name),
  }),
  defineRoute({
    method: "patch",
    path: "/projects/:projectId/epics/:epicId",
    operationId: "renameEpic",
    summary: "Rename an epic",
    tags,
    request: { params: epicParams, body: nameBody },
    response: { status: 200, schema: epicSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      service.renameEpic(actor, params.projectId, params.epicId, body.name),
  }),
  defineRoute({
    method: "delete",
    path: "/projects/:projectId/epics/:epicId",
    operationId: "deleteEpic",
    summary: "Delete an epic and its ticket links (project managers)",
    tags,
    request: { params: epicParams },
    response: { status: 204 },
    errors: [403, 404, 409],
    handler: ({ actor, params }) => service.deleteEpic(actor, params.projectId, params.epicId),
  }),
];
