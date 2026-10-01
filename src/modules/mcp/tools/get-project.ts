import { z } from "zod";
import { LIMITS } from "../../../shared/security/rate-limit.js";
import { defineTool, READ_ANNOTATIONS } from "../mcp.tool.js";
import { loadProjectMetadata, resolveProject } from "../mcp.scope.js";

export const getProjectTool = defineTool({
  name: "get_project",
  title: "Get project",
  description:
    "Look up one SpaceScope project by id, key or name and return everything needed to create a ticket: ticket types, priorities, statuses, epics, sprints and assignable members.",
  inputSchema: z.object({
    project: z.string().trim().min(1).describe("Project id, key (e.g. SS) or name."),
  }),
  annotations: READ_ANNOTATIONS,
  limits: LIMITS.mcpRead,
  handler: async ({ project }, actor) => {
    const found = await resolveProject(actor, project);
    const meta = await loadProjectMetadata(actor, found.id);
    const result = { project: found, ...meta };
    return { text: JSON.stringify(result, null, 2), structuredContent: result };
  },
});
