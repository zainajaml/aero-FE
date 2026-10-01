import { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";
import { logger } from "../../../shared/observability/logger.js";
import { LIMITS } from "../../../shared/security/rate-limit.js";
import { writeAuditEvent } from "../../audit/audit.service.js";
import { createTicket } from "../../tickets/tickets.service.js";
import { ticketUrl } from "../mcp.config.js";
import { ToolError } from "../mcp.errors.js";
import { defineTool } from "../mcp.tool.js";
import {
  assertCanCreateTickets,
  loadProjectMetadata,
  matchByName,
  matchMember,
  resolveProject,
  TICKET_PRIORITIES,
  TICKET_TYPES,
} from "../mcp.scope.js";
import { parseEstimateMinutes, textToDocumentJson } from "../mcp.tickets.js";
import { isoDay } from "./ticket-filters.js";

const isCalendarDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const createTicketTool = defineTool({
  name: "create_ticket",
  title: "Create ticket",
  description:
    "Create a SpaceScope ticket. ONLY `title` and `description` are required (plus `project` when the target project is unknown). " +
    'A request like "create a ticket called X with description Y" is already complete — create it immediately. ' +
    "Do NOT ask the user for background, problem statement, acceptance criteria, technical specs, database table/column/data type, " +
    "implementation details, estimate, assignee, sprint, epic, priority, status, story points or due date, and do not invent them. " +
    "Omitted optional fields use the same defaults as the SpaceScope UI (type=task, priority=medium, first board column, unassigned, no sprint/epic, no estimate). " +
    "Only ask for clarification if title or description is missing, or if the project is genuinely ambiguous.",
  inputSchema: z.object({
    project: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Project id, key (e.g. SS) or name. Ask only if the target project is unknown or ambiguous.",
      ),
    title: z.string().trim().min(1).max(200).describe("Required. Use the user's wording as-is."),
    description: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .describe(
        "Required. Plain text or markdown — use exactly what the user gave; do not expand it into a template or request more detail.",
      ),
    ticket_type: z.enum(TICKET_TYPES).optional().describe('Defaults to "task".'),
    priority: z.enum(TICKET_PRIORITIES).optional().describe('Defaults to "medium".'),
    status: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Board column name or id; defaults to the first column."),
    assignee: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Member name or email, or "unassigned".'),
    epic: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).max(10)]).optional(),
    sprint: z.string().trim().min(1).optional().describe('Sprint name, id, or "current".'),
    estimate: z
      .union([z.string().trim().min(1), z.number().nonnegative()])
      .optional()
      .describe('e.g. "2h 30m", "1d", or a number of minutes.'),
    story_points: z.number().int().min(0).max(1000).optional(),
    due_date: isoDay.optional().describe("YYYY-MM-DD."),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  limits: LIMITS.mcpCreate,
  handler: async (input, actor) => {
    const project = await resolveProject(actor, input.project);
    await assertCanCreateTickets(actor, project.id);

    const meta = await loadProjectMetadata(actor, project.id);
    const statuses = meta.statuses ?? [];
    const sprints = meta.sprints ?? [];

    // Status → board column of this project; the first column by default, like the UI.
    let column = statuses[0] ?? null;
    if (input.status) column = matchByName(statuses, input.status, "status");

    // The assignee must be a current, non-archived member of this project.
    let assignee: { user_id: string; name: string; email: string | null } | null = null;
    if (input.assignee && input.assignee.toLowerCase() !== "unassigned") {
      assignee = matchMember(meta.members ?? [], input.assignee);
    }

    // The sprint must belong to this project and must not be completed.
    let sprint: { id: string; name: string } | null = null;
    if (input.sprint) {
      const found =
        input.sprint.toLowerCase() === "current"
          ? sprints.find((s) => s.is_current)
          : matchByName(sprints, input.sprint, "sprint");
      if (!found) throw new ToolError("This project has no active sprint.");
      if (found.status === "completed") {
        throw new ToolError("You cannot assign tickets to completed sprints.");
      }
      sprint = { id: found.id, name: found.name };
    }

    const epicRefs = input.epic ? (Array.isArray(input.epic) ? input.epic : [input.epic]) : [];
    const epics = epicRefs.map((ref) => matchByName(meta.epics ?? [], ref, "epic"));
    const estimateMinutes = parseEstimateMinutes(input.estimate ?? null);
    if (input.due_date && !isCalendarDate(input.due_date)) {
      throw new ToolError("due_date must be a valid YYYY-MM-DD date.");
    }

    const type = input.ticket_type ?? "task";
    const priority = input.priority ?? "medium";
    let ticket;
    try {
      // The shared creation path: same validation, code allocation, position, stage history,
      // epic links, estimates, audit and assignee notification as the web app.
      ticket = await createTicket(actor, project.id, {
        title: input.title,
        descriptionJson: textToDocumentJson(input.description),
        type,
        priority,
        columnId: column?.id ?? null,
        sprintId: sprint?.id ?? null,
        assigneeId: assignee?.user_id ?? null,
        storyPoints: input.story_points ?? null,
        dueDate: input.due_date ?? null,
        epicIds: epics.map((e) => e.id),
        estimates:
          estimateMinutes > 0 ? [{ resourceType: "developer", minutes: estimateMinutes }] : [],
      });
    } catch (error) {
      const reason = error instanceof AppError ? error.message : "Ticket creation failed";
      logger.warn(
        { userId: actor.userId, projectId: project.id, reason, source: "mcp" },
        "mcp create_ticket failed",
      );
      if (error instanceof AppError) throw new ToolError(error.message);
      throw error;
    }

    const url = ticketUrl(ticket.id);
    logger.info(
      { userId: actor.userId, projectId: project.id, ticketCode: ticket.code, source: "mcp" },
      "mcp create_ticket ok",
    );
    await writeAuditEvent({
      actorUserId: actor.userId,
      action: "create",
      event: "tickets.mcp",
      table: "tickets",
      entityId: ticket.id,
      projectId: project.id,
      link: `/ticket/${ticket.id}`,
      summary: `${ticket.code} created via MCP`,
    });

    const result = {
      id: ticket.id,
      code: ticket.code,
      title: ticket.title,
      project: { id: project.id, name: project.name, key: project.key },
      status: column?.name ?? null,
      priority,
      type,
      assignee: assignee ? { name: assignee.name, email: assignee.email } : null,
      sprint,
      url,
    };
    return { text: `Created ${ticket.code}: ${ticket.title}\n${url}`, structuredContent: result };
  },
});
