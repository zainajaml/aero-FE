import { env } from "../../config/env.js";

const apiOrigin = env.API_URL.replace(/\/+$/, "");

/** Canonical MCP protected-resource identifier (RFC 8707 / RFC 9728); tokens are audience-bound to it. */
export const MCP_RESOURCE = `${apiOrigin}/mcp`;

/** Path the MCP endpoint is mounted at, derived from the resource so the two cannot drift. */
export const MCP_PATH = new URL(MCP_RESOURCE).pathname;

/** Frontend pages the authorization server redirects the browser to. */
export const OAUTH_LOGIN_PAGE = `${env.APP_URL.replace(/\/+$/, "")}/login`;
export const OAUTH_CONSENT_PAGE = `${env.APP_URL.replace(/\/+$/, "")}/oauth/consent`;

/** Absolute URL of a ticket in the web app. */
export const ticketUrl = (ticketId: string) =>
  `${env.APP_URL.replace(/\/+$/, "")}/ticket/${ticketId}`;
