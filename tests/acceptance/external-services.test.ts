import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { db } from "../../src/database/client.js";
import { comments } from "../../src/database/schema/index.js";
import { createActor } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { call, newTicket, projectWorld } from "../support/project-world.js";

// Outbound services are faked at the fetch boundary; the configuration is set per test.

const original = { ...env };
let requests: { url: URL; headers: Headers }[] = [];

function fakeUpstream(host: string, respond: (url: URL) => Response) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : (input as Request).url,
    );
    if (url.hostname !== host) return realFetch(input, init);
    requests.push({ url, headers: new Headers(init?.headers) });
    return respond(url);
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  await resetDatabase();
  requests = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, original);
});

describe("billing report proxy", () => {
  it("forwards allowlisted reports with the server-side key and tenant", async () => {
    Object.assign(env, {
      BILLING_API_URL: "https://billing.test",
      BILLING_API_KEY: "billing-key",
      BILLING_TENANT_ID: "tenant-1",
    });
    fakeUpstream("billing.test", () => json({ data: { total: 42 } }));
    const superAdmin = await createActor({ roles: ["super_admin"] });
    const response = await superAdmin.agent.get("/api/v1/billing/kpis?from=2026-01-01");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ total: 42 });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.pathname).toBe("/api/billing/kpis");
    expect(requests[0]!.url.searchParams.get("tenantId")).toBe("tenant-1");
    expect(requests[0]!.url.searchParams.get("from")).toBe("2026-01-01");
    expect(requests[0]!.headers.get("x-api-key")).toBe("billing-key");

    const member = await createActor();
    expect((await member.agent.get("/api/v1/billing/kpis")).status).toBe(403);
    expect(requests).toHaveLength(1);
  });
});

describe("AI comment summary", () => {
  it("returns empty sections without calling the model when there are no comments", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    const response = await call(w.developer, "post", `/tickets/${t.id}/comment-summary`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ issue: [], solution: [], nextSteps: [] });
  });

  it("summarises the thread through the configured model", async () => {
    Object.assign(env, { GOOGLE_GENERATIVE_AI_API_KEY: "test-ai-key" });
    const summary = { issue: ["Login fails"], solution: ["Reset token"], next_steps: ["Deploy"] };
    fakeUpstream("generativelanguage.googleapis.com", () =>
      json({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: `\`\`\`json\n${JSON.stringify(summary)}\n\`\`\`` }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
      }),
    );
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    await db
      .insert(comments)
      .values({ ticketId: t.id, authorId: w.developer.id, body: "login fails" });
    const response = await call(w.viewer, "post", `/tickets/${t.id}/comment-summary`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      issue: ["Login fails"],
      solution: ["Reset token"],
      nextSteps: ["Deploy"],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.pathname).toContain(env.AI_SUMMARY_MODEL);
  });
});
