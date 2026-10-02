import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import { rateLimitCounters, verifications } from "../../src/database/schema/index.js";
import { purgeExpiredRows } from "../../src/modules/maintenance/maintenance.service.js";
import { resetDatabase } from "../support/db.js";

beforeEach(resetDatabase);

describe("expired-row purge", () => {
  it("removes only rows whose expiry has passed", async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const window = { namespace: "t", windowSeconds: 60, windowStart: past, requestCount: 1 };
    await db.insert(rateLimitCounters).values([
      { ...window, identifierHash: "old", expiresAt: past },
      { ...window, identifierHash: "live", expiresAt: future },
    ]);
    await db.insert(verifications).values([
      { identifier: "old", value: "x", expiresAt: past },
      { identifier: "live", value: "y", expiresAt: future },
    ]);

    const result = await purgeExpiredRows();

    expect(result).toMatchObject({ rateLimits: 1, verifications: 1 });
    expect((await db.select().from(rateLimitCounters)).map((r) => r.identifierHash)).toEqual([
      "live",
    ]);
    expect((await db.select().from(verifications)).map((r) => r.identifier)).toEqual(["live"]);
  });
});
