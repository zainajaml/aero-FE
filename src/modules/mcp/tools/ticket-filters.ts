import { z } from "zod";
import { TICKET_PRIORITIES, TICKET_TYPES } from "../mcp.scope.js";
import { TICKET_PAGE_DEFAULT, TICKET_PAGE_MAX } from "../mcp.tickets.js";

/** Filter inputs shared by list_tickets and search_tickets. */
export const ticketFilterShape = {
  status: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Board column name or id (needs `project`)."),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  ticket_type: z.enum(TICKET_TYPES).optional(),
  assignee: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Member name or email, or "me" / "unassigned" (needs `project`).'),
  sprint: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Sprint name, id, or "current" (needs `project`).'),
  epic: z.string().trim().min(1).optional().describe("Epic name or id (needs `project`)."),
  open_only: z.boolean().optional().describe("Exclude tickets in done columns."),
};

export const ticketPageShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(TICKET_PAGE_MAX)
    .optional()
    .describe(`Page size. Defaults to ${TICKET_PAGE_DEFAULT}, max ${TICKET_PAGE_MAX}.`),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Rows to skip; use next_offset from the previous page."),
};

export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
