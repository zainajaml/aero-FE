import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../src/openapi.js";
import { APP_ORIGIN, app, createActor, type TestActor } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";

// Sweeps every documented /api/v1 operation, so a new route cannot ship without its guard.

type Parameter = { in: string; name: string; schema?: { format?: string } };
type Operation = { security?: unknown[]; parameters?: Parameter[] };
type Method = "get" | "post" | "put" | "patch" | "delete";

const document = buildOpenApiDocument();
const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
  Object.entries(item as Record<Method, Operation>).map(([method, op]) => ({
    path,
    method: method as Method,
    op,
  })),
);

/** Valid-looking values for non-UUID path parameters. */
const SAMPLE_PARAMS: Record<string, string> = {
  report: "kpis",
  key: "ticket-assigned",
  jiraProjectId: "10000",
};

const fill = (path: string, value: (name: string) => string) =>
  path.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => value(name));

const envelope = {
  error: { code: expect.any(String), message: expect.any(String), details: expect.any(Array) },
  meta: { requestId: expect.any(String) },
};

describe("authentication guard", () => {
  const authenticated = operations.filter((o) => (o.op.security ?? []).length > 0);

  it("covers every operation except the documented public ones", () => {
    const publicOps = operations
      .filter((o) => (o.op.security ?? []).length === 0)
      .map((o) => `${o.method.toUpperCase()} ${o.path}`)
      .sort();
    expect(publicOps).toEqual([
      "GET /api/v1/email/unsubscribe",
      "GET /api/v1/jira/oauth/callback",
      "POST /api/v1/email/unsubscribe",
      "POST /api/v1/invitations/accept-with-password",
      "POST /api/v1/invitations/lookup",
    ]);
    expect(authenticated.length).toBe(operations.length - publicOps.length);
  });

  it.each(authenticated.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o] as const))(
    "%s rejects anonymous callers with 401",
    async (_name, { method, path }) => {
      const url = fill(path, (name) => SAMPLE_PARAMS[name] ?? randomUUID());
      const response = await request(app)[method](url).set("Origin", APP_ORIGIN).send({});
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject(envelope);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    },
  );
});

describe("path parameter validation", () => {
  let actor: TestActor;
  beforeAll(async () => {
    await resetDatabase();
    actor = await createActor({ roles: ["super_admin"] });
  });

  const withIds = operations.filter((o) =>
    (o.op.parameters ?? []).some((p) => p.in === "path" && p.schema?.format === "uuid"),
  );

  it.each(withIds.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o] as const))(
    "%s answers 400 for a malformed id",
    async (_name, { method, path, op }) => {
      const uuidParams = new Set(
        (op.parameters ?? [])
          .filter((p) => p.in === "path" && p.schema?.format === "uuid")
          .map((p) => p.name),
      );
      const url = fill(path, (name) =>
        uuidParams.has(name) ? "not-a-uuid" : (SAMPLE_PARAMS[name] ?? randomUUID()),
      );
      const response = await actor.agent[method](url).set("Origin", APP_ORIGIN).send({});
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject(envelope);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    },
  );
});
