import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { AppError, RateLimitedError } from "../../shared/http/errors.js";
import { logger } from "../../shared/observability/logger.js";
import { enforceRateLimit } from "../../shared/security/rate-limit.js";
import type { Actor } from "../access/access.types.js";
import { ToolError } from "./mcp.errors.js";
import type { McpToolDefinition } from "./mcp.tool.js";
import { createTicketTool } from "./tools/create-ticket.js";
import { getProjectTool } from "./tools/get-project.js";
import { getTicketTool } from "./tools/get-ticket.js";
import { listAccountsTool } from "./tools/list-accounts.js";
import { listProjectsTool } from "./tools/list-projects.js";
import { listTicketMetadataTool } from "./tools/list-ticket-metadata.js";
import { listTicketsTool } from "./tools/list-tickets.js";
import { resolveProjectContextTool } from "./tools/resolve-project-context.js";
import { searchTicketsTool } from "./tools/search-tickets.js";

const SERVER_INFO = { name: "space-scope", title: "Space Scope", version: "1.0.0" };

const INSTRUCTIONS =
  "Tools for SpaceScope project delivery. Use list_accounts / list_projects / get_project to find the right project context, list_ticket_metadata or resolve_project_context to turn names into ids, list_tickets / search_tickets / get_ticket to read existing tickets, and create_ticket to file a new one. Everything runs as the signed-in SpaceScope user, so you only see and change what that user is allowed to. Ticket creation is the only write action. In SpaceScope a valid ticket needs only a title and a description: when the user supplies both, call create_ticket right away and never ask for background, problem statements, acceptance criteria, technical or database details, estimates, assignees, sprints, epics, priority or status. Omitted fields fall back to the SpaceScope UI defaults. The only clarification worth asking for is a missing title/description or a genuinely ambiguous project.";

// Erased form for the registry; each definition keeps its own inferred input type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = McpToolDefinition<any>;

const MCP_TOOLS: AnyTool[] = [
  listAccountsTool,
  listProjectsTool,
  getProjectTool,
  listTicketMetadataTool,
  resolveProjectContextTool,
  listTicketsTool,
  searchTicketsTool,
  getTicketTool,
  createTicketTool,
];

const errorResult = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

async function runTool(tool: AnyTool, input: unknown, actor: Actor): Promise<CallToolResult> {
  try {
    // Identity is the verified token subject; never anything the client can choose.
    await enforceRateLimit({
      namespace: `mcp:${tool.name}`,
      identifier: actor.userId,
      windows: tool.limits,
      failClosed: true,
    });
    const result = await tool.handler(input, actor);
    return {
      content: [{ type: "text", text: result.text }],
      structuredContent: result.structuredContent,
    };
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return errorResult(
        `Rate limit exceeded for ${tool.name}. Retry in ${error.retryAfterSeconds}s.`,
      );
    }
    if (error instanceof ToolError || error instanceof AppError) return errorResult(error.message);
    logger.error({ err: error, tool: tool.name, userId: actor.userId }, "mcp tool failed");
    return errorResult("Something went wrong. Please try again.");
  }
}

/** A fresh MCP server bound to one verified actor (one per HTTP request). */
export function buildMcpServer(actor: Actor): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (input: unknown) => runTool(tool, input, actor),
    );
  }
  return server;
}
