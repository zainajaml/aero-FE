import { z } from "zod";
import { LIMITS } from "../../../shared/security/rate-limit.js";
import { defineTool, READ_ANNOTATIONS } from "../mcp.tool.js";
import {
  describePage,
  formatTicketLine,
  queryTickets,
  resolveTicketScope,
  TICKET_PAGE_DEFAULT,
  TICKET_PAGE_MAX,
} from "../mcp.tickets.js";
import { ticketFilterShape, ticketPageShape } from "./ticket-filters.js";

export const searchTicketsTool = defineTool({
  name: "search_tickets",
  title: "Search tickets",
  description: `Search existing SpaceScope tickets by keyword against ticket title and ticket code, across one project, one account, or every project the signed-in user can access. Optional status/priority/type/assignee/sprint/epic filters narrow the results further. Searching, filtering and paging all happen in the database: ${TICKET_PAGE_DEFAULT} matches per page by default (max ${TICKET_PAGE_MAX}). When more results exist, call again with the returned next_offset.`,
  inputSchema: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("Keyword, ticket code (e.g. NEU-142) or title fragment."),
    project: z.string().trim().min(1).optional().describe("Project id, key or name."),
    account_id: z.uuid().optional().describe("Limit to projects in one account."),
    ...ticketFilterShape,
    ...ticketPageShape,
  }),
  annotations: READ_ANNOTATIONS,
  limits: LIMITS.mcpRead,
  handler: async (input, actor) => {
    const projects = await resolveTicketScope(actor, {
      project: input.project,
      account_id: input.account_id,
    });
    const { tickets, page } = await queryTickets(actor, projects, input);
    const text = tickets.length
      ? `${page.total} match(es) for "${input.query}"${describePage(page)}:\n` +
        tickets.map((t) => `${formatTicketLine(t)}\n${t.url}`).join("\n\n")
      : `No accessible tickets match "${input.query}".`;
    return {
      text,
      structuredContent: { query: input.query, count: tickets.length, page, tickets },
    };
  },
});
