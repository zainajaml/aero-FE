import type { RequestHandler } from "express";
import { toNodeHandler } from "better-auth/node";
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { env } from "../../config/env.js";
import { logger } from "../../shared/observability/logger.js";
import { loadActor } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import { auth } from "../auth/auth.js";
import { MCP_RESOURCE } from "./mcp.config.js";
import { buildMcpServer } from "./mcp.server.js";

/**
 * The JWKS the access tokens are verified against, fetched (and cached for five minutes by
 * Better Auth) from this same process over loopback, so verification never depends on the public
 * API hostname resolving from inside the deployment.
 */
const JWKS_URL = `http://127.0.0.1:${env.PORT}/api/auth/jwks`;

// Modern (2026-07-28) MCP plus stateless 2025-era requests for clients that have not upgraded;
// one server per request, plain JSON responses.
const mcpHandler = createMcpHandler(({ authInfo }) => buildMcpServer(actorOf(authInfo)), {
  legacy: "stateless",
  responseMode: "json",
  onerror: (error) => logger.warn({ err: error }, "mcp request rejected"),
});

function actorOf(authInfo: AuthInfo | undefined): Actor {
  const actor = authInfo?.extra?.["actor"] as Actor | undefined;
  if (!actor) throw new Error("MCP request reached the server without a verified actor");
  return actor;
}

const jsonRpcError = (status: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const bearerToken = (request: Request) =>
  (request.headers.get("authorization") ?? "").replace(/^\S+\s+/, "");

/**
 * Verifies the bearer token (signature, issuer, audience = MCP_RESOURCE, expiry, DPoP binding);
 * missing or invalid tokens get a 401 whose WWW-Authenticate header points at the protected
 * resource metadata. The tools then run as the token's user, loaded like a session actor.
 */
const protectedMcp = requireMcpAuth(
  auth,
  async (request, claims) => {
    const userId = typeof claims.sub === "string" ? claims.sub : null;
    const actor = userId ? await loadActor(userId) : null;
    if (!actor) return jsonRpcError(403, "This access token is not linked to a SpaceScope user.");
    if (actor.isArchived) return jsonRpcError(403, "This account has been archived.");
    const scope = typeof claims.scope === "string" ? claims.scope : "";
    const clientId = claims.azp ?? claims.client_id;
    return mcpHandler.fetch(request, {
      authInfo: {
        token: bearerToken(request),
        clientId: typeof clientId === "string" ? clientId : "",
        scopes: scope.split(" ").filter(Boolean),
        expiresAt: claims.exp,
        resource: new URL(MCP_RESOURCE),
        extra: { actor },
      },
    });
  },
  { resource: MCP_RESOURCE, jwksUrl: JWKS_URL },
);

const nodeHandler = toNodeHandler(protectedMcp);

/** POST /mcp. Mounted before express.json(): the MCP handler reads the raw body itself. */
export const mcpRequestHandler: RequestHandler = (req, res, next) => {
  nodeHandler(req, res).catch(next);
};

/** Only POST is served; GET/DELETE session operations of the 2025 transport do not exist here. */
export const mcpMethodNotAllowed: RequestHandler = (_req, res) => {
  res
    .set("Allow", "POST")
    .status(405)
    .json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
};
