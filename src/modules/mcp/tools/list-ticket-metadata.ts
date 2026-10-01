import { z } from "zod";
import { LIMITS } from "../../../shared/security/rate-limit.js";
import { defineTool, READ_ANNOTATIONS } from "../mcp.tool.js";
import { loadProjectMetadata, METADATA_KINDS, resolveProject } from "../mcp.scope.js";

const KINDS = ["types", "priorities", "statuses", "epics", "sprints", "members"] as const;

export const listTicketMetadataTool = defineTool({
  name: "list_ticket_metadata",
  title: "List ticket metadata",
  description:
    "Lightweight lookup of the valid ticket field values for a project: ticket types, priorities, statuses (board columns), epics, sprints (with the current sprint flagged) and assignable members.",
  inputSchema: z.object({
    project: z.string().trim().min(1).describe("Project id, key or name."),
    kinds: z
      .array(z.enum(KINDS))
      .min(1)
      .optional()
      .describe("Which lists to return; defaults to all."),
  }),
  annotations: READ_ANNOTATIONS,
  limits: LIMITS.mcpRead,
  handler: async ({ project, kinds }, actor) => {
    const found = await resolveProject(actor, project);
    const meta = await loadProjectMetadata(actor, found.id, kinds ?? METADATA_KINDS);
    const result = { project: { id: found.id, name: found.name, key: found.key }, ...meta };
    return { text: JSON.stringify(result, null, 2), structuredContent: result };
  },
});
