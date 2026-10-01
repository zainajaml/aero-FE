import { z } from "zod";
import { LIMITS } from "../../../shared/security/rate-limit.js";
import { ToolError } from "../mcp.errors.js";
import { defineTool, READ_ANNOTATIONS } from "../mcp.tool.js";
import { loadProjectMetadata, matchByName, matchMember, resolveProject } from "../mcp.scope.js";

const reason = (error: unknown) => {
  if (error instanceof ToolError) return error.message;
  throw error;
};

/**
 * One-shot resolver so a client can turn a natural-language request ("high-priority bug in
 * SpaceScope, assign Abdul, current sprint") into ids before calling create_ticket. Anything
 * ambiguous is reported instead of guessed.
 */
export const resolveProjectContextTool = defineTool({
  name: "resolve_project_context",
  title: "Resolve project context",
  description:
    "Resolve human-readable project, assignee, epic and sprint names to SpaceScope ids, reporting anything ambiguous or unmatched instead of guessing.",
  inputSchema: z.object({
    project: z.string().trim().min(1).describe("Project id, key or name."),
    assignee: z.string().trim().min(1).optional().describe("Member name or email."),
    epic: z.string().trim().min(1).optional().describe("Epic name or id."),
    sprint: z.string().trim().min(1).optional().describe('Sprint name, id, or "current".'),
  }),
  annotations: READ_ANNOTATIONS,
  limits: LIMITS.mcpRead,
  handler: async ({ project, assignee, epic, sprint }, actor) => {
    const found = await resolveProject(actor, project);
    const meta = await loadProjectMetadata(actor, found.id);

    const unresolved: { field: string; reason: string }[] = [];
    const result: Record<string, unknown> = {
      project: { id: found.id, name: found.name, key: found.key },
    };

    if (assignee) {
      try {
        const member = matchMember(meta.members ?? [], assignee);
        result["assignee"] = { user_id: member.user_id, name: member.name, email: member.email };
      } catch (error) {
        unresolved.push({ field: "assignee", reason: reason(error) });
      }
    }
    if (epic) {
      try {
        result["epic"] = matchByName(meta.epics ?? [], epic, "epic");
      } catch (error) {
        unresolved.push({ field: "epic", reason: reason(error) });
      }
    }
    if (sprint) {
      const sprints = meta.sprints ?? [];
      if (sprint.toLowerCase() === "current") {
        const current = sprints.find((s) => s.is_current);
        if (current) result["sprint"] = current;
        else unresolved.push({ field: "sprint", reason: "This project has no active sprint." });
      } else {
        try {
          result["sprint"] = matchByName(sprints, sprint, "sprint");
        } catch (error) {
          unresolved.push({ field: "sprint", reason: reason(error) });
        }
      }
    }
    result["unresolved"] = unresolved;
    return { text: JSON.stringify(result, null, 2), structuredContent: result };
  },
});
