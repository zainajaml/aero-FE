import { z } from "zod";
import { LIMITS } from "../../../shared/security/rate-limit.js";
import { defineTool, READ_ANNOTATIONS } from "../mcp.tool.js";
import { findTicket } from "../mcp.tickets.js";

export const getTicketTool = defineTool({
  name: "get_ticket",
  title: "Get ticket",
  description:
    "Retrieve the full details of one existing SpaceScope ticket by ticket code (e.g. NEU-142) or id, including description, project, status, priority, type, assignee, sprint, epics, estimate, logged time, story points, due date and its SpaceScope URL.",
  inputSchema: z.object({
    ticket: z.string().trim().min(1).describe("Ticket code (e.g. NEU-142) or ticket id."),
  }),
  annotations: READ_ANNOTATIONS,
  limits: LIMITS.mcpRead,
  handler: async ({ ticket }, actor) => {
    const found = await findTicket(actor, ticket);
    return { text: JSON.stringify(found, null, 2), structuredContent: { ticket: found } };
  },
});
