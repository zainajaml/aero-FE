import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../src/openapi.js";
import { apiRoutes } from "../../src/routes.js";

const document = buildOpenApiDocument();
const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
  Object.entries(
    item as Record<string, { operationId?: string; responses?: Record<string, unknown> }>,
  ).map(([method, op]) => ({ path, method, op })),
);

describe("OpenAPI contract", () => {
  it("documents every mounted route exactly once with a unique operation id", () => {
    expect(operations).toHaveLength(apiRoutes.length);
    const ids = operations.map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const route of apiRoutes) {
      const path = `/api/v1${route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`;
      expect(
        operations.some((o) => o.path === path && o.method === route.method),
        `${route.method} ${path}`,
      ).toBe(true);
    }
  });

  it("documents validation and server errors with the error envelope on every operation", () => {
    for (const { op, path } of operations) {
      expect(op.responses?.["400"], path).toBeDefined();
      expect(op.responses?.["500"], path).toBeDefined();
    }
  });

  it("matches the committed openapi/openapi.json (run npm run openapi:generate)", () => {
    const committed = JSON.parse(readFileSync("openapi/openapi.json", "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(document)));
  });
});
