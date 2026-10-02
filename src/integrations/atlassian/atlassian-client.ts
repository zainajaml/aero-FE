import pRetry, { AbortError } from "p-retry";
import { logger } from "../../shared/observability/logger.js";

// Atlassian Cloud OAuth 2.0 (3LO) and Jira REST client. Endpoints are fixed constants (tests
// replace `fetch`, not these values). Response bodies are never logged: they can carry PII.

const ATLASSIAN_AUTH_BASE = "https://auth.atlassian.com";
const ATLASSIAN_API_BASE = "https://api.atlassian.com";

/** "read:jira-user" lets imports read Jira user emails to match authors automatically. */
export const JIRA_SCOPES = "read:jira-work read:jira-user offline_access";

const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_RETRY_AFTER_MS = 10_000;
const MAX_REDIRECTS = 3;

/** A failed Atlassian call; `status` is 0 for network failures and timeouts. */
export class AtlassianHttpError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
    options?: { cause?: unknown },
  ) {
    super(`Atlassian ${operation} failed (${status})`, options);
    this.name = "AtlassianHttpError";
  }
}

class TransientHttpError extends AtlassianHttpError {
  constructor(
    status: number,
    operation: string,
    readonly retryAfterMs: number | null,
  ) {
    super(status, operation);
  }
}

/** Refused before any request: the URL would send the bearer token somewhere else. */
export class ForeignHostError extends Error {
  constructor() {
    super("Refusing to send Jira credentials to a non-Atlassian API host");
    this.name = "ForeignHostError";
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One HTTP exchange with bounded retries: at most 2 retries, only for 429, 5xx, network errors
 * and timeouts, honouring Retry-After (capped). Other statuses fail immediately.
 */
async function send(
  operation: string,
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await pRetry(
      async () => {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel().catch(() => undefined);
          throw new TransientHttpError(
            response.status,
            operation,
            parseRetryAfter(response.headers.get("retry-after")),
          );
        }
        if (response.status >= 400) {
          await response.body?.cancel().catch(() => undefined);
          throw new AbortError(new AtlassianHttpError(response.status, operation));
        }
        return response;
      },
      {
        retries: 2,
        minTimeout: 300,
        maxTimeout: 2_000,
        onFailedAttempt: async ({ error, retriesLeft }) => {
          if (retriesLeft > 0 && error instanceof TransientHttpError && error.retryAfterMs) {
            await sleep(Math.min(error.retryAfterMs, MAX_RETRY_AFTER_MS));
          }
        },
      },
    );
  } catch (error) {
    const failure =
      error instanceof AtlassianHttpError
        ? new AtlassianHttpError(error.status, operation)
        : new AtlassianHttpError(0, operation, { cause: error });
    logger.warn({ operation, status: failure.status }, "atlassian request failed");
    throw failure;
  }
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

export type AccessibleResource = { id: string; name?: string; url?: string; scopes?: string[] };

export type OAuthClient = { clientId: string; clientSecret: string; redirectUri: string };

export function buildAuthorizeUrl(client: OAuthClient, state: string): string {
  const url = new URL("/authorize", ATLASSIAN_AUTH_BASE);
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("scope", JIRA_SCOPES);
  url.searchParams.set("redirect_uri", client.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  // The request carries the client secret and refresh token; neither side is ever logged.
  const response = await send("token", `${ATLASSIAN_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const tokens = (await response.json()) as Partial<TokenResponse>;
  if (!tokens.access_token || typeof tokens.expires_in !== "number")
    throw new AtlassianHttpError(response.status, "token");
  return tokens as TokenResponse;
}

export function exchangeCode(client: OAuthClient, code: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    redirect_uri: client.redirectUri,
  });
}

export function refreshTokens(client: OAuthClient, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
  });
}

export async function accessibleResources(accessToken: string): Promise<AccessibleResource[]> {
  const response = await send(
    "accessible-resources",
    `${ATLASSIAN_API_BASE}/oauth/token/accessible-resources`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
  );
  const sites = (await response.json()) as unknown;
  return Array.isArray(sites) ? (sites as AccessibleResource[]) : [];
}

/** Credentials of one connected Jira site, in memory only. */
export type JiraCredentials = { cloudId: string; accessToken: string };

/** Jira REST call through the OAuth gateway, scoped to the connected cloud id. */
export async function jiraRequest<T>(
  credentials: JiraCredentials,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const url = `${ATLASSIAN_API_BASE}/ex/jira/${encodeURIComponent(credentials.cloudId)}${path}`;
  const response = await send(`jira ${init.method ?? "GET"} ${path.split("?")[0]}`, url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  return (await response.json()) as T;
}

/**
 * Where an attachment content URL may be fetched with the bearer token. Site URLs
 * (`https://<site>.atlassian.net/...`) are rewritten to the API gateway for the connected cloud;
 * gateway URLs must stay inside that cloud. Anything else is refused.
 */
export function resolveAttachmentUrl(cloudId: string, contentUrl: string): URL {
  let target: URL;
  try {
    target = new URL(contentUrl);
  } catch {
    throw new ForeignHostError();
  }
  const api = new URL(ATLASSIAN_API_BASE);
  if (target.username || target.password) throw new ForeignHostError();
  if (target.protocol === "https:" && target.hostname.endsWith(".atlassian.net")) {
    return new URL(
      `/ex/jira/${encodeURIComponent(cloudId)}${target.pathname}${target.search}`,
      api,
    );
  }
  if (
    target.origin === api.origin &&
    target.pathname.startsWith(`/ex/jira/${encodeURIComponent(cloudId)}/`)
  ) {
    return target;
  }
  throw new ForeignHostError();
}

class AttachmentTooLargeError extends Error {
  constructor() {
    super("Attachment exceeds the import size limit");
    this.name = "AttachmentTooLargeError";
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AttachmentTooLargeError();
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AttachmentTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads an attachment with the user's token so Jira permissions still apply. The bearer
 * token is sent only to the Atlassian API gateway; redirects (pre-signed media URLs) are
 * followed without it.
 */
export async function jiraBinary(
  credentials: JiraCredentials,
  contentUrl: string,
  maxBytes: number,
): Promise<{ body: Buffer; contentType: string | null }> {
  const first = resolveAttachmentUrl(credentials.cloudId, contentUrl);
  let response = await send(
    "attachment download",
    first.toString(),
    { headers: { Authorization: `Bearer ${credentials.accessToken}` }, redirect: "manual" },
    DOWNLOAD_TIMEOUT_MS,
  );
  let current = first;
  for (let hop = 0; response.status >= 300 && response.status < 400; hop += 1) {
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location || hop >= MAX_REDIRECTS)
      throw new AtlassianHttpError(response.status, "download");
    current = new URL(location, current);
    if (current.protocol !== "https:") throw new ForeignHostError();
    response = await send(
      "attachment download",
      current.toString(),
      { redirect: "manual" },
      DOWNLOAD_TIMEOUT_MS,
    );
  }
  return {
    body: await readCapped(response, maxBytes),
    contentType: response.headers.get("content-type"),
  };
}
