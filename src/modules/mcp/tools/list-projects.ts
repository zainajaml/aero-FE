import { z } from "zod";
import { LIMITS } from "../../../shared/security/rate-limit.js";
import { defineTool, READ_ANNOTATIONS } from "../mcp.tool.js";
import {
  listAccessibleProjectsPage,
  PROJECT_PAGE_DEFAULT,
  PROJECT_PAGE_MAX,
} from "../mcp.scope.js";
import { buildPageInfo, describePage } from "../mcp.tickets.js";

export const listProjectsTool = defineTool({
  name: "list_projects",
  title: "List projects",
  description: `List the SpaceScope projects the signed-in user can access, optionally filtered by account or a name/key search. Results are paginated server-side: ${PROJECT_PAGE_DEFAULT} projects per page by default (max ${PROJECT_PAGE_MAX}). When more results exist, call again with the returned next_offset.`,
  inputSchema: z.object({
    account_id: z.uuid().optional().describe("Filter to one account (a filter, not a grant)."),
    query: z.string().trim().max(100).optional().describe("Match against project name or key."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(PROJECT_PAGE_MAX)
      .optional()
      .describe(`Page size. Defaults to ${PROJECT_PAGE_DEFAULT}, max ${PROJECT_PAGE_MAX}.`),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Rows to skip; use next_offset from the previous page."),
  }),
  annotations: READ_ANNOTATIONS,
  limits: LIMITS.mcpRead,
  handler: async ({ account_id, query, limit, offset }, actor) => {
    const result = await listAccessibleProjectsPage(actor, {
      accountId: account_id,
      query,
      limit,
      offset,
    });
    const page = buildPageInfo(result.limit, result.offset, result.total, result.projects.length);
    return {
      text: result.projects.length
        ? `${result.total} project(s)${describePage(page)}:\n` +
          result.projects.map((p) => `${p.name} [${p.key}] — ${p.id}`).join("\n")
        : "No accessible projects match.",
      structuredContent: { projects: result.projects, page },
    };
  },
});
