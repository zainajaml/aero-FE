import { describe, expect, it } from "vitest";
import * as policy from "../access.policy.js";
import type { Actor, ProjectScope } from "../access.types.js";

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  userId: "u1",
  email: "u1@example.com",
  emailVerified: true,
  isArchived: false,
  globalRoles: [],
  adminAccountIds: [],
  ...overrides,
});
const scope = (overrides: Partial<ProjectScope> = {}): ProjectScope => ({
  projectId: "p1",
  accountId: "a1",
  archivedAt: null,
  memberRole: null,
  ...overrides,
});

describe("project policy", () => {
  it("lets super admins, account admins and members see a project", () => {
    expect(policy.isProjectMember(actor({ globalRoles: ["super_admin"] }), scope())).toBe(true);
    expect(policy.isProjectMember(actor({ adminAccountIds: ["a1"] }), scope())).toBe(true);
    expect(policy.isProjectMember(actor(), scope({ memberRole: "viewer" }))).toBe(true);
  });

  it("hides projects from outsiders and admins of other accounts", () => {
    expect(policy.isProjectMember(actor(), scope())).toBe(false);
    expect(policy.isProjectMember(actor({ adminAccountIds: ["a2"] }), scope())).toBe(false);
  });

  it("denies every rule to archived identities", () => {
    const archived = actor({
      isArchived: true,
      globalRoles: ["super_admin"],
      adminAccountIds: ["a1"],
    });
    expect(policy.isSuperAdmin(archived)).toBe(false);
    expect(policy.isProjectMember(archived, scope({ memberRole: "admin" }))).toBe(false);
    expect(policy.canManageProject(archived, scope({ memberRole: "admin" }))).toBe(false);
  });

  it("only project admins, account admins and super admins manage a project", () => {
    expect(policy.canManageProject(actor(), scope({ memberRole: "admin" }))).toBe(true);
    expect(policy.canManageProject(actor(), scope({ memberRole: "developer" }))).toBe(false);
    expect(policy.canManageProject(actor({ adminAccountIds: ["a1"] }), scope())).toBe(true);
  });

  it("treats viewers and non-members as read-only and archived projects as read-only for all", () => {
    expect(policy.canWriteProject(actor(), scope({ memberRole: "viewer" }))).toBe(false);
    expect(policy.canWriteProject(actor(), scope({ memberRole: "developer" }))).toBe(true);
    expect(
      policy.canWriteProject(actor(), scope({ memberRole: "developer", archivedAt: new Date() })),
    ).toBe(false);
    expect(policy.isProjectViewer(actor({ adminAccountIds: ["a1"] }), scope())).toBe(false);
  });
});

describe("access status", () => {
  it("mirrors the source app gate", () => {
    expect(policy.accessStatus(actor(), false)).toBe("needs_onboarding");
    expect(policy.accessStatus(actor({ globalRoles: ["developer"] }), false)).toBe("no_access");
    expect(policy.accessStatus(actor({ globalRoles: ["developer"] }), true)).toBe("active");
    expect(policy.accessStatus(actor({ globalRoles: ["super_admin"] }), false)).toBe("active");
    expect(policy.accessStatus(actor({ adminAccountIds: ["a1"] }), false)).toBe("active");
    expect(policy.accessStatus(actor({ isArchived: true }), true)).toBe("archived");
  });
});
