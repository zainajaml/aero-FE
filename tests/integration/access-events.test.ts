import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accessEvents } from "../../src/modules/access/access-events.js";
import { addMember, app, createAccount, createActor, createProject } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await accessEvents.close();
});
beforeEach(resetDatabase);

/** Opens the SSE stream with the actor's cookies and collects event names. */
function openStream(cookie: string) {
  const events: string[] = [];
  const request = http.get(
    `${baseUrl}/api/v1/me/access-events`,
    { headers: { cookie } },
    (response) => {
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        for (const match of chunk.matchAll(/^event: (\w+)$/gm)) events.push(match[1]!);
      });
    },
  );
  return { events, close: () => request.destroy() };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for event");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("GET /me/access-events", () => {
  it("rejects anonymous callers", async () => {
    const response = await fetch(`${baseUrl}/api/v1/me/access-events`);
    expect(response.status).toBe(401);
  });

  it("pushes a change event when the user's membership changes", async () => {
    const actor = await createActor();
    const cookie = actor.agent.jar
      .getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: false })
      .toValueString();
    const stream = openStream(cookie);
    await waitFor(() => stream.events.includes("ready"));
    await addMember((await createProject((await createAccount()).id)).id, actor.id, "viewer");
    await waitFor(() => stream.events.includes("changed"));
    stream.close();
  });
});
