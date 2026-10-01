import { randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import {
  accessibleResources,
  buildAuthorizeUrl,
  exchangeCode,
  JIRA_SCOPES,
  refreshTokens,
  type TokenResponse,
} from "../../integrations/atlassian/atlassian-client.js";
import { NotFoundError } from "../../shared/http/errors.js";
import { logger } from "../../shared/observability/logger.js";
import { enforceRateLimit } from "../../shared/security/rate-limit.js";
import type { Actor } from "../access/access.types.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import * as repo from "./connection.repository.js";
import { isJiraConfigured, jiraConfig } from "./jira.config.js";
import {
  JiraNotConnectedError,
  JiraReconnectRequiredError,
  withJiraErrors,
} from "./jira.errors.js";

const REFRESH_MARGIN_MS = 60_000;
const OAUTH_STATE_TTL_MS = 15 * 60_000;
const CONNECT_LIMIT = [
  { limit: 10, windowSeconds: 10 * 60 },
  { limit: 50, windowSeconds: 24 * 60 * 60 },
];

/** A connection with credentials decrypted for in-memory use only. */
export type LiveConnection = {
  userId: string;
  cloudId: string;
  siteUrl: string | null;
  siteName: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
};

const expiresSoon = (expiresAt: Date) => expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
const expiryFrom = (tokens: TokenResponse) => new Date(Date.now() + tokens.expires_in * 1000);

function decrypt(row: repo.ConnectionRow): LiveConnection {
  const { cipher } = jiraConfig();
  return {
    userId: row.userId,
    cloudId: row.cloudId,
    siteUrl: row.siteUrl,
    siteName: row.siteName,
    accessToken: cipher.decrypt(row.accessToken),
    refreshToken: row.refreshToken ? cipher.decrypt(row.refreshToken) : null,
    expiresAt: row.expiresAt,
  };
}

/**
 * Returns a connection whose access token is valid for at least a minute. Refreshes are
 * serialized per user: the row is locked, and expiry is re-checked after the lock is acquired
 * so concurrent requests reuse the token the first one obtained (Atlassian rotates refresh
 * tokens, so a second refresh with the old one would fail).
 */
export async function getValidConnection(userId: string): Promise<LiveConnection> {
  const { oauth, cipher } = jiraConfig();
  const row = await repo.findConnection(db, userId);
  if (!row) throw new JiraNotConnectedError();
  if (!expiresSoon(row.expiresAt)) return decrypt(row);
  return db.transaction(async (tx) => {
    const locked = await repo.lockConnection(tx, userId);
    if (!locked) throw new JiraNotConnectedError();
    const current = decrypt(locked);
    if (!expiresSoon(locked.expiresAt)) return current;
    if (!current.refreshToken) throw new JiraReconnectRequiredError();
    const tokens = await refreshTokens(oauth, current.refreshToken);
    const refreshed: LiveConnection = {
      ...current,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? current.refreshToken,
      expiresAt: expiryFrom(tokens),
    };
    await repo.updateConnection(tx, userId, {
      accessToken: cipher.encrypt(refreshed.accessToken),
      refreshToken: refreshed.refreshToken ? cipher.encrypt(refreshed.refreshToken) : null,
      expiresAt: refreshed.expiresAt,
      scope: tokens.scope ?? locked.scope ?? JIRA_SCOPES,
    });
    return refreshed;
  });
}

export async function getStatus(actor: Actor) {
  const configured = isJiraConfigured();
  const callbackUrl = env.JIRA_REDIRECT_URI ?? null;
  const row = configured ? await repo.findConnection(db, actor.userId) : null;
  if (!row) return { connected: false, configured, callbackUrl };
  return {
    connected: true,
    configured,
    cloudId: row.cloudId,
    siteName: row.siteName,
    siteUrl: row.siteUrl,
    expiresAt: row.expiresAt.toISOString(),
    callbackUrl,
  };
}

/** Stores a single-use CSRF state and returns the Atlassian consent URL. */
export async function startLogin(actor: Actor) {
  const { oauth } = jiraConfig();
  await enforceRateLimit({
    namespace: "jira:connect",
    identifier: actor.userId,
    windows: CONNECT_LIMIT,
  });
  const state = randomBytes(32).toString("hex");
  await repo.insertOauthState(db, state, actor.userId);
  await repo.deleteOauthStatesBefore(db, new Date(Date.now() - OAUTH_STATE_TTL_MS));
  return { authorizeUrl: buildAuthorizeUrl(oauth, state) };
}

export type CallbackOutcome = {
  title: string;
  message: string;
  status: "connected" | "error";
  /** `?jira=` value for the redirect back to the app, or null for a plain return. */
  result: "connected" | "error" | null;
};

const failed = (message: string, result: "error" | null = null): CallbackOutcome => ({
  title: "Jira connection failed",
  message,
  status: "error",
  result,
});

/**
 * Completes the OAuth flow. The user comes from the stored state row, never from the query
 * string; the state is consumed on first use and must be younger than 15 minutes.
 */
export async function completeLogin(input: {
  code?: string | undefined;
  state?: string | undefined;
  error?: string | undefined;
}): Promise<CallbackOutcome> {
  const stateRow = input.state ? await repo.consumeOauthState(db, input.state) : null;
  if (input.error) {
    return {
      title: "Jira connection cancelled",
      message: input.error,
      status: "error",
      result: "error",
    };
  }
  if (!input.code || !input.state) return failed("Missing authorization code or state.");
  if (!stateRow) return failed("Invalid or expired state parameter.");
  if (Date.now() - stateRow.createdAt.getTime() > OAUTH_STATE_TTL_MS)
    return failed("The consent link expired. Try again.");

  const { oauth, cipher } = jiraConfig();
  try {
    const tokens = await exchangeCode(oauth, input.code);
    const sites = await accessibleResources(tokens.access_token);
    // As in the source, the first granted site becomes active; PUT /jira/site switches it.
    const site = sites.find((s) => typeof s.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(s.id));
    if (!site) return failed("No accessible Jira sites for this Atlassian account.");
    await repo.upsertConnection(db, {
      userId: stateRow.userId,
      cloudId: site.id,
      siteUrl: site.url ?? null,
      siteName: site.name ?? null,
      accessToken: cipher.encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? cipher.encrypt(tokens.refresh_token) : null,
      expiresAt: expiryFrom(tokens),
      scope: tokens.scope ?? JIRA_SCOPES,
    });
    await writeAuditEvent({
      actorUserId: stateRow.userId,
      action: "create",
      event: "jira.connected",
      table: "jira_connections",
      entityId: stateRow.userId,
      link: "/jira",
      summary: "Connected Jira",
      metadata: { cloud_id: site.id, site_name: site.name ?? null },
      critical: true,
    });
    return {
      title: "Jira connected",
      message: `Linked to ${site.name ?? site.id}.`,
      status: "connected",
      result: "connected",
    };
  } catch (error) {
    logger.warn({ err: error }, "jira oauth callback failed");
    return failed("Could not complete the Atlassian token exchange.", "error");
  }
}

export async function disconnect(actor: Actor) {
  jiraConfig();
  await repo.deleteConnection(db, actor.userId);
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "delete",
    event: "jira.disconnected",
    table: "jira_connections",
    entityId: actor.userId,
    link: "/jira",
    summary: "Disconnected Jira",
    critical: true,
  });
}

/** All Atlassian sites the connected account granted; empty when not connected or unreachable. */
export async function listSites(actor: Actor) {
  jiraConfig();
  try {
    const connection = await getValidConnection(actor.userId);
    const sites = await accessibleResources(connection.accessToken);
    return sites.map((s) => ({
      cloudId: s.id,
      name: s.name ?? null,
      url: s.url ?? null,
      active: s.id === connection.cloudId,
    }));
  } catch {
    return [];
  }
}

/** Switches the stored connection to another site this connection actually granted. */
export async function selectSite(actor: Actor, cloudId: string) {
  return withJiraErrors(async () => {
    const connection = await getValidConnection(actor.userId);
    const sites = await accessibleResources(connection.accessToken);
    const site = sites.find((s) => s.id === cloudId);
    if (!site) throw new NotFoundError("Jira site", "JIRA_SITE_NOT_FOUND");
    await repo.updateConnection(db, actor.userId, {
      cloudId: site.id,
      siteName: site.name ?? null,
      siteUrl: site.url ?? null,
    });
    await writeAuditEvent({
      actorUserId: actor.userId,
      action: "update",
      event: "jira.site_changed",
      table: "jira_connections",
      entityId: actor.userId,
      link: "/jira",
      summary: "Switched the connected Jira site",
      metadata: { cloud_id: site.id, site_name: site.name ?? null },
    });
    return { cloudId: site.id, name: site.name ?? null, url: site.url ?? null, active: true };
  });
}
