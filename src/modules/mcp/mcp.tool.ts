import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { RateWindow } from "../../shared/security/rate-limit.js";
import type { Actor } from "../access/access.types.js";

type ToolResult = { text: string; structuredContent: Record<string, unknown> };

export type McpToolDefinition<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  /** Per-user budget for this tool (each tool has its own counter). */
  limits: RateWindow[];
  /** Runs as the access token's user; throw ToolError for messages meant for the client. */
  handler: (input: z.infer<S>, actor: Actor) => Promise<ToolResult>;
};

/** Identity helper that keeps the handler's input type inferred from its schema. */
export function defineTool<S extends z.ZodObject>(
  tool: McpToolDefinition<S>,
): McpToolDefinition<S> {
  return tool;
}

export const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
