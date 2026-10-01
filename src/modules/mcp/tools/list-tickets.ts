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
import { isoDay, ticketFilterShape, ticketPageShape } from "./ticket-filters.js";

export const listTicketsTool = defineTool({
  name: "list_tickets",
  title: "List tickets",
  description: `List existing SpaceScope tickets for one project, or across an account / every project the signed-in user can access. Supports filtering by status, priority, ticket type, assignee, sprint, epic, due date, overdue and open-only. Status, assignee, sprint and epic filters require a single project because those values are per project. All filters and the page window are applied by the database: ${TICKET_PAGE_DEFAULT} tickets per page by default (max ${TICKET_PAGE_MAX}). When more results exist, call again with the returned next_offset.`,
  inputSchema: z.object({
    project: z.string().trim().min(1).optional().describe("Project id, key (e.g. NEU) or name."),
    account_id: z
      .uuid()
      .optional()
      .describe("Limit to projects in one account (a filter, not a grant)."),
    ...ticketFilterShape,
    overdue: z.boolean().optional().describe("Only tickets whose due date has passed."),
    due_before: isoDay.optional(),
    due_after: isoDay.optional(),
    released: z.boolean().optional(),
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
    const scope = projects.length === 1 ? projects[0]!.name : `${projects.length} projects`;
    const text = tickets.length
      ? `${page.total} ticket(s) in ${scope}${describePage(page)}:\n` +
        tickets.map((t) => `${formatTicketLine(t)}\n${t.url}`).join("\n\n")
      : `No tickets in ${scope} match those filters.`;
    return {
      text,
      structuredContent: {
        scope: projects.map((p) => ({ id: p.id, name: p.name, key: p.key })),
        count: tickets.length,
        page,
        tickets,
      },
    };
  },
});
