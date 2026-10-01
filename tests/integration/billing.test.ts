import { beforeEach, describe, expect, it } from "vitest";
import { createActor } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";

beforeEach(resetDatabase);

describe("GET /billing/:report", () => {
  it("is limited to super admins and reports when the integration is not configured", async () => {
    const member = await createActor({ roles: ["account_admin"] });
    expect((await member.agent.get("/api/v1/billing/kpis")).status).toBe(403);
    const superAdmin = await createActor({ roles: ["super_admin"] });
    const response = await superAdmin.agent.get("/api/v1/billing/kpis?from=2026-01-01");
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("BILLING_NOT_CONFIGURED");
    expect((await superAdmin.agent.get("/api/v1/billing/secrets")).status).toBe(400);
  });
});
