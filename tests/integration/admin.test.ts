import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import {
  accountAdmins,
  profiles,
  tickets,
  users,
  workLogs,
} from "../../src/database/schema/index.js";
import { createActor, makeAccountAdmin } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { call, newTicket, projectWorld } from "../support/project-world.js";

beforeEach(resetDatabase);

describe("user management listing", () => {
  it("clips users to the caller's scope and hides higher identities from project admins", async () => {
    const w = await projectWorld();
    const superAdmin = await createActor({ roles: ["super_admin"] });
    const asProjectAdmin = (await call(w.manager, "get", "/admin/users")).body.data;
    const ids = asProjectAdmin.users.map((u: { id: string }) => u.id);
    expect(ids).toContain(w.developer.id);
    expect(ids).not.toContain(w.accountAdmin.id);
    expect(ids).not.toContain(superAdmin.id);
    expect(ids).not.toContain(w.outsider.id);
    expect(asProjectAdmin.scope).toMatchObject({ isClientAdmin: true, inviteLimit: 10 });
    const asAccountAdmin = (
      await call(w.accountAdmin, "get", `/admin/users?accountId=${w.account.id}`)
    ).body.data;
    expect(asAccountAdmin.users.find((u: { id: string }) => u.id === w.developer.id)).toMatchObject(
      { role: "developer", projectIds: [w.project.id] },
    );
    expect(asAccountAdmin.scope).toMatchObject({
      contextScoped: true,
      contextIsAccountAdmin: true,
      inviteLimit: null,
    });
    expect((await call(w.developer, "get", "/admin/users")).status).toBe(403);
    expect((await call(w.manager, "get", `/admin/users?projectId=${w.outsider.id}`)).status).toBe(
      403,
    );
  });
});

describe("role and access changes", () => {
  it("changes project roles inside scope, grants account admin explicitly and protects the last account admin", async () => {
    const w = await projectWorld();
    expect(
      (
        await call(w.manager, "put", `/admin/users/${w.developer.id}/access`, {
          role: "viewer",
          projectIds: [w.project.id],
          contextProjectId: w.project.id,
        })
      ).status,
    ).toBe(200);
    const access = (await call(w.developer, "get", "/me/access")).body.data;
    expect(access.projectRoles).toEqual({ [w.project.id]: "viewer" });
    expect(
      (
        await call(w.manager, "put", `/admin/users/${w.developer.id}/access`, {
          role: "account_admin",
          accountIds: [w.account.id],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(w.accountAdmin, "put", `/admin/users/${w.teammate.id}/access`, {
          role: "account_admin",
          accountIds: [w.account.id],
        })
      ).status,
    ).toBe(200);
    expect(
      await db.select().from(accountAdmins).where(eq(accountAdmins.userId, w.teammate.id)),
    ).toHaveLength(1);
    // Demoting the only other admin is fine; removing the last one is refused.
    await call(w.accountAdmin, "put", `/admin/users/${w.teammate.id}/access`, {
      role: "developer",
      projectIds: [w.project.id],
      contextAccountId: w.account.id,
    });
    const self = await call(w.accountAdmin, "put", `/admin/users/${w.accountAdmin.id}/access`, {
      role: "developer",
      projectIds: [w.project.id],
      contextAccountId: w.account.id,
    });
    expect(self.body.error.code).toBe("LAST_ACCOUNT_ADMIN");
    expect(
      (
        await call(w.manager, "put", `/admin/users/${w.outsider.id}/access`, {
          role: "viewer",
          projectIds: [w.project.id],
        })
      ).status,
    ).toBe(403);
  });

  it("removes access but keeps history; deletes only footprint-free identities", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    await db.insert(workLogs).values({ ticketId: t.id, userId: w.teammate.id, minutes: 15 });
    const removed = (
      await call(
        w.manager,
        "delete",
        `/admin/users/${w.teammate.id}/access?projectId=${w.project.id}`,
      )
    ).body.data;
    expect(removed).toEqual({ deleted: false, removedProjects: 1, hasRemainingAccess: false });
    expect(await db.select().from(workLogs)).toHaveLength(1);
    const superAdmin = await createActor({ roles: ["super_admin"] });
    expect(
      (await call(superAdmin, "delete", `/admin/users/${w.teammate.id}/access`)).body.error.code,
    ).toBe("NO_ACCESS_TO_REMOVE");
    const lonely = await createActor();
    expect(
      (await call(superAdmin, "delete", `/admin/users/${lonely.id}/access`)).body.data.deleted,
    ).toBe(true);
    expect(await db.select().from(users).where(eq(users.id, lonely.id))).toHaveLength(0);
  });

  it("archives with ticket reassignment in one step and restores", async () => {
    const w = await projectWorld();
    await newTicket(w.developer, w.project.id, { assigneeId: w.teammate.id });
    const superAdmin = await createActor({ roles: ["super_admin"] });
    const open = (await call(superAdmin, "get", `/admin/users/${w.teammate.id}/open-tickets`)).body
      .data;
    expect(open.tickets).toHaveLength(1);
    expect(open.candidates.map((c: { id: string }) => c.id)).toContain(w.developer.id);
    expect(
      (await call(w.accountAdmin, "post", `/admin/users/${w.teammate.id}/archive`, {})).status,
    ).toBe(403);
    const archived = (
      await call(superAdmin, "post", `/admin/users/${w.teammate.id}/archive`, {
        reassign: { assigneeId: w.developer.id },
      })
    ).body.data;
    expect(archived).toEqual({ archived: true, reassignedTickets: 1 });
    expect((await db.select().from(tickets))[0]!.assigneeId).toBe(w.developer.id);
    expect((await call(w.teammate, "get", "/me")).status).toBe(403);
    await call(superAdmin, "post", `/admin/users/${w.teammate.id}/restore`);
    expect(
      (await db.select().from(profiles).where(eq(profiles.id, w.teammate.id)))[0]!.archivedAt,
    ).toBeNull();
  });

  it("sets the email of imported placeholders only", async () => {
    const w = await projectWorld();
    await db
      .update(users)
      .set({ email: "ghost-1@jira-import.invalid" })
      .where(eq(users.id, w.teammate.id));
    expect(
      (
        await call(w.accountAdmin, "put", `/admin/users/${w.developer.id}/email`, {
          email: "x@example.com",
        })
      ).body.error.code,
    ).toBe("EMAIL_ALREADY_SET");
    expect(
      (
        await call(w.accountAdmin, "put", `/admin/users/${w.teammate.id}/email`, {
          email: w.developer.email,
        })
      ).body.error.code,
    ).toBe("EMAIL_TAKEN");
    expect(
      (
        await call(w.accountAdmin, "put", `/admin/users/${w.teammate.id}/email`, {
          email: "Real@Example.com",
        })
      ).body.data.email,
    ).toBe("real@example.com");
  });
});

describe("audit viewer", () => {
  it("shows admins only their projects' events and super admins everything", async () => {
    const w = await projectWorld();
    await newTicket(w.developer, w.project.id);
    await makeAccountAdmin(
      (await import("../support/actors.js").then((m) => m.createAccount())).id,
      w.outsider.id,
    );
    const managerView = (await call(w.manager, "get", "/audit-logs")).body.data;
    expect(
      managerView.items.some(
        (i: { projectId: string; userName: string }) =>
          i.projectId === w.project.id && i.userName === "Dev Eloper",
      ),
    ).toBe(true);
    expect(
      (await call(w.outsider, "get", "/audit-logs")).body.data.items.some(
        (i: { projectId: string }) => i.projectId === w.project.id,
      ),
    ).toBe(false);
    expect((await call(w.developer, "get", "/audit-logs")).status).toBe(403);
    const superAdmin = await createActor({ roles: ["super_admin"] });
    const all = (
      await call(superAdmin, "get", "/audit-logs?q=ticket&sort=user&dir=asc&pageSize=50")
    ).body.data;
    expect(all.total).toBeGreaterThan(0);
  });
});
