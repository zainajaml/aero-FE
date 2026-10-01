import { z } from "zod";
import { LIMITS } from "../../../shared/security/rate-limit.js";
import { listVisibleAccounts } from "../../accounts/accounts.service.js";
import { defineTool, READ_ANNOTATIONS } from "../mcp.tool.js";

export const listAccountsTool = defineTool({
  name: "list_accounts",
  title: "List accounts",
  description:
    "List the SpaceScope accounts the signed-in user can access. Use this first to find the right account context.",
  inputSchema: z.object({}),
  annotations: READ_ANNOTATIONS,
  limits: LIMITS.mcpRead,
  handler: async (_input, actor) => {
    const accounts = (await listVisibleAccounts(actor)).map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
    }));
    return {
      text: accounts.length
        ? accounts.map((a) => `${a.name} (${a.slug}) — ${a.id}`).join("\n")
        : "No accessible accounts.",
      structuredContent: { accounts },
    };
  },
});
