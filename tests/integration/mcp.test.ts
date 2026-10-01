import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/database/client.js";
import { auditLogs, profiles, projectMembers, tickets } from "../../src/database/schema/index.js";
import { auth } from "../../src/modules/auth/auth.js";
import { MCP_RESOURCE } from "../../src/modules/mcp/mcp.config.js";
import {
  APP_ORIGIN,
  PASSWORD,
  addMember,
  app,
  createProject,
  type TestActor,
} from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { newTicket, projectWorld, type World } from "../support/project-world.js";
import request from "supertest";

// The MCP endpoint verifies tokens against the JWKS it fetches from its own process over
// loopback (http://127.0.0.1:PORT/api/auth/jwks). Tests do not listen on that port, so that one
// URL is answered by the in-process auth handler; every other request uses the real fetch.
const JWKS_URL = "http://127.0.0.1:4000/api/auth/jwks";
const realFetch = globalThis.fetch;

let server: Server;
let mcpUrl: URL;

beforeAll(async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (url === JWKS_URL) return auth.handler(new Request("https://api.test/api/auth/jwks"));
    return realFetch(input, init);
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  mcpUrl = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await resetDatabase();
});

const REDIRECT_URI = "https://mcp-client.example/oauth/callback";
const base64url = (buffer: Buffer) => buffer.toString("base64url");

/** Dynamic client registration exactly as an MCP client performs it (no cookies, no Origin). */
async function registerClient(): Promise<string> {
  const response = await request(app)
    .post("/api/auth/oauth2/register")
    .send({
      client_name: "Test MCP client",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  expect(response.status, response.text).toBe(201);
  return response.body.client_id as string;
}

/**
 * The full authorization-code flow with PKCE: authorize with the user's session cookie, approve
 * on the consent page (POST /oauth2/consent with the signed query), exchange the code.
 */
async function obtainAccessToken(actor: TestActor, clientId?: string): Promise<string> {
  const client = clientId ?? (await registerClient());
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const authorize = await actor.agent.get("/api/auth/oauth2/authorize").query({
    response_type: "code",
    client_id: client,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_RESOURCE,
  });
  expect(authorize.status, authorize.text).toBe(302);
  const consentPage = new URL(authorize.headers.location as string);
  expect(`${consentPage.origin}${consentPage.pathname}`).toBe(`${APP_ORIGIN}/oauth/consent`);
  expect(consentPage.searchParams.get("client_id")).toBe(client);

  const consent = await actor.agent
    .post("/api/auth/oauth2/consent")
    .set("Origin", APP_ORIGIN)
    .send({ accept: true, oauth_query: consentPage.search.slice(1) });
  expect(consent.status, consent.text).toBe(200);
  const callback = new URL(consent.body.url as string);
  expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI);
  expect(callback.searchParams.get("state")).toBe("xyz");
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();

  const token = await request(app).post("/api/auth/oauth2/token").type("form").send({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: client,
    code_verifier: verifier,
    resource: MCP_RESOURCE,
  });
  expect(token.status, token.text).toBe(200);
  expect(token.body.refresh_token).toBeTruthy();
  return token.body.access_token as string;
}

async function connect(accessToken: string): Promise<Client> {
  const client = new Client(
    { name: "integration-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(mcpUrl, {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
  );
  return client;
}

async function mcpAs(actor: TestActor): Promise<Client> {
  return connect(await obtainAccessToken(actor));
}

type ToolCall = { isError?: boolean; content: { type: string; text?: string }[] } & {
  structuredContent?: Record<string, unknown>;
};

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as ToolCall;
}

const textOf = (result: ToolCall) => result.content.map((c) => c.text ?? "").join("\n");

describe("MCP authorization", () => {
  it("rejects an unauthenticated MCP call with a challenge pointing at the resource metadata", async () => {
    const response = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain(
      'resource_metadata="https://api.test/.well-known/oauth-protected-resource/mcp"',
    );

    const garbage = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer not-a-real-token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(garbage.status).toBe(401);
  });

  it("serves the protected-resource and authorization-server metadata", async () => {
    const resource = await request(app).get("/.well-known/oauth-protected-resource/mcp");
    expect(resource.status).toBe(200);
    expect(resource.body).toMatchObject({
      resource: MCP_RESOURCE,
      authorization_servers: ["https://api.test/api/auth"],
      bearer_methods_supported: ["header"],
    });

    const server = await request(app).get("/.well-known/oauth-authorization-server/api/auth");
    expect(server.status).toBe(200);
    expect(server.body).toMatchObject({
      issuer: "https://api.test/api/auth",
      authorization_endpoint: "https://api.test/api/auth/oauth2/authorize",
      token_endpoint: "https://api.test/api/auth/oauth2/token",
      registration_endpoint: "https://api.test/api/auth/oauth2/register",
      code_challenge_methods_supported: ["S256"],
    });
    expect(server.body.grant_types_supported).not.toContain("client_credentials");

    const oidc = await request(app).get("/api/auth/.well-known/openid-configuration");
    expect(oidc.status).toBe(200);
  });

  it("sends a browser without a session to the login page and only accepts POST on /mcp", async () => {
    const client = await registerClient();
    const authorize = await request(app)
      .get("/api/auth/oauth2/authorize")
      .query({
        response_type: "code",
        client_id: client,
        redirect_uri: REDIRECT_URI,
        scope: "openid offline_access",
        code_challenge: "x".repeat(43),
        code_challenge_method: "S256",
        resource: MCP_RESOURCE,
      });
    expect(authorize.status).toBe(302);
    const login = new URL(authorize.headers.location as string);
    expect(`${login.origin}${login.pathname}`).toBe(`${APP_ORIGIN}/login`);
    expect(login.searchParams.get("sig")).toBeTruthy();
    const oauthQuery = login.search.slice(1);

    // The login page can name the client before sign-in, from the signed query only.
    const prelogin = await request(app)
      .post("/api/auth/oauth2/public-client-prelogin")
      .set("Origin", APP_ORIGIN)
      .send({ client_id: client, oauth_query: oauthQuery });
    expect(prelogin.status).toBe(200);
    expect(prelogin.body).toMatchObject({ client_id: client, client_name: "Test MCP client" });

    // Signing in with the oauth_query continues the authorization (here: to the consent page).
    const w = await projectWorld();
    const signIn = await request(app)
      .post("/api/auth/sign-in/email")
      .set("Origin", APP_ORIGIN)
      .send({ email: w.developer.email, password: PASSWORD, oauth_query: oauthQuery });
    expect(signIn.status).toBe(200);
    expect(signIn.body.redirect).toBe(true);
    expect(signIn.body.url).toMatch(new RegExp(`^${APP_ORIGIN}/oauth/consent\\?`));

    const tampered = await w.developer.agent
      .post("/api/auth/oauth2/consent")
      .set("Origin", APP_ORIGIN)
      .send({ accept: true, oauth_query: oauthQuery.replace("scope=openid", "scope=email") });
    expect(tampered.status).toBe(400);

    expect((await request(app).get("/mcp")).status).toBe(405);
  });

  it("returns access_denied to the client when the user declines", async () => {
    const w = await projectWorld();
    const client = await registerClient();
    const authorize = await w.developer.agent.get("/api/auth/oauth2/authorize").query({
      response_type: "code",
      client_id: client,
      redirect_uri: REDIRECT_URI,
      scope: "openid offline_access",
      state: "s1",
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
      resource: MCP_RESOURCE,
    });
    const consentPage = new URL(authorize.headers.location as string);
    const deny = await w.developer.agent
      .post("/api/auth/oauth2/consent")
      .set("Origin", APP_ORIGIN)
      .send({ accept: false, oauth_query: consentPage.search.slice(1) });
    expect(deny.status).toBe(200);
    const callback = new URL(deny.body.url as string);
    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.get("state")).toBe("s1");
  });

  it("rejects 2025-era (legacy) MCP requests", async () => {
    const w = await projectWorld();
    const token = await obtainAccessToken(w.developer);
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "legacy", version: "1" },
        },
      });
    expect(response.status).toBe(400);
    expect(response.body.error.data.supported).toEqual(["2026-07-28"]);
  });

  it("refuses OAuth client administration to regular users", async () => {
    const w = await projectWorld();
    const response = await w.manager.agent
      .post("/api/auth/oauth2/create-client")
      .set("Origin", APP_ORIGIN)
      .send({ redirect_uris: [REDIRECT_URI] });
    expect(response.status).toBe(401);
  });

  it("rejects tokens of archived users", async () => {
    const w = await projectWorld();
    const token = await obtainAccessToken(w.developer);
    await db
      .update(profiles)
      .set({ archivedAt: new Date() })
      .where(eq(profiles.id, w.developer.id));
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("This account has been archived.");
  });
});

describe("MCP tools", () => {
  let w: World;
  beforeEach(async () => {
    w = await projectWorld();
  });

  it("lists the nine tools", async () => {
    const client = await mcpAs(w.developer);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "create_ticket",
        "get_project",
        "get_ticket",
        "list_accounts",
        "list_projects",
        "list_ticket_metadata",
        "list_tickets",
        "resolve_project_context",
        "search_tickets",
      ].sort(),
    );
    expect(tools.find((t) => t.name === "create_ticket")!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    await client.close();
  });

  it("list_projects returns only the caller's visible, non-archived projects", async () => {
    const archived = await createProject(w.account.id, { archivedAt: new Date() });
    await addMember(archived.id, w.developer.id, "developer");
    const client = await mcpAs(w.developer);

    const result = await callTool(client, "list_projects");
    expect(result.isError).toBeFalsy();
    const projects = result.structuredContent!.projects as { id: string }[];
    expect(projects.map((p) => p.id)).toEqual([w.project.id]);
    expect(result.structuredContent!.page).toMatchObject({ total: 1, has_more: false });

    const accounts = await callTool(client, "list_accounts");
    expect((accounts.structuredContent!.accounts as { id: string }[]).map((a) => a.id)).toEqual([
      w.account.id,
    ]);
    await client.close();
  });

  it("get_ticket answers the same for invisible and unknown tickets", async () => {
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.userId, w.outsider.id));
    const hidden = await newTicket(w.outsider, membership!.projectId);
    const mine = await newTicket(w.developer, w.project.id, { title: "Visible one" });
    const client = await mcpAs(w.developer);

    const invisible = await callTool(client, "get_ticket", { ticket: hidden.code });
    const byId = await callTool(client, "get_ticket", { ticket: hidden.id });
    const unknown = await callTool(client, "get_ticket", { ticket: "NOPE-999" });
    for (const result of [invisible, byId, unknown]) {
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Ticket not found, or you do not have access to it.");
    }

    const found = await callTool(client, "get_ticket", { ticket: mine.code.toLowerCase() });
    expect(found.isError).toBeFalsy();
    expect(found.structuredContent!.ticket).toMatchObject({
      id: mine.id,
      code: mine.code,
      title: "Visible one",
      description: "Do it",
      url: `${APP_ORIGIN}/ticket/${mine.id}`,
      project: { id: w.project.id, key: w.project.key },
    });
    await client.close();
  });

  it("create_ticket is refused to viewers and creates KEY-n tickets for developers", async () => {
    const viewer = await mcpAs(w.viewer);
    const refused = await callTool(viewer, "create_ticket", {
      project: w.project.key,
      title: "Nope",
      description: "Viewers cannot write",
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe(
      "You have view-only access to this project and cannot create tickets.",
    );
    await viewer.close();

    const developer = await mcpAs(w.developer);
    const created = await callTool(developer, "create_ticket", {
      project: w.project.name,
      title: "Login button broken",
      description: "Clicking it does nothing.\nOn every browser.",
      ticket_type: "bug",
      priority: "high",
      assignee: "Tea Mate",
      estimate: "1h 30m",
      due_date: "2026-12-01",
    });
    expect(created.isError, textOf(created)).toBeFalsy();
    const ticket = created.structuredContent as {
      id: string;
      code: string;
      url: string;
      status: string;
      assignee: { name: string };
    };
    expect(ticket.code).toBe(`${w.project.key}-1`);
    expect(ticket.status).toBe("To Do");
    expect(ticket.assignee.name).toBe("Tea Mate");
    expect(ticket.url).toBe(`${APP_ORIGIN}/ticket/${ticket.id}`);

    const [row] = await db.select().from(tickets).where(eq(tickets.id, ticket.id));
    expect(row).toMatchObject({
      reporterId: w.developer.id,
      assigneeId: w.teammate.id,
      type: "bug",
      priority: "high",
      estimateMinutes: 90,
      dueDate: "2026-12-01",
      columnId: w.columns[0].id,
    });
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.tableName, "tickets"));
    expect(audits.map((a) => a.field)).toEqual(
      expect.arrayContaining(["tickets.title", "tickets.mcp"]),
    );

    const invalid = await callTool(developer, "create_ticket", {
      project: w.project.key,
      title: "Bad date",
      description: "x",
      due_date: "2026-02-31",
    });
    expect(textOf(invalid)).toBe("due_date must be a valid YYYY-MM-DD date.");

    const listed = await callTool(developer, "list_tickets", {
      project: w.project.key,
      assignee: "Tea Mate",
      open_only: true,
    });
    expect((listed.structuredContent!.tickets as { code: string }[]).map((t) => t.code)).toEqual([
      ticket.code,
    ]);
    const searched = await callTool(developer, "search_tickets", { query: "login%" });
    expect(searched.structuredContent!.count).toBe(1);
    await developer.close();
  });

  it("enforces the per-user create_ticket rate limit", async () => {
    const client = await mcpAs(w.developer);
    for (let i = 0; i < 10; i += 1) {
      const result = await callTool(client, "create_ticket", {
        project: w.project.key,
        title: `Ticket ${i}`,
        description: "Burst",
      });
      expect(result.isError, textOf(result)).toBeFalsy();
    }
    const limited = await callTool(client, "create_ticket", {
      project: w.project.key,
      title: "One too many",
      description: "Burst",
    });
    expect(limited.isError).toBe(true);
    expect(textOf(limited)).toMatch(/^Rate limit exceeded for create_ticket\. Retry in \d+s\.$/);
    // Reads have their own budget and still work.
    expect((await callTool(client, "list_projects")).isError).toBeFalsy();
    await client.close();
  });
});
