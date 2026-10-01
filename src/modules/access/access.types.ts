import type { AppRole } from "../../database/schema/_shared.js";

/** The verified caller, loaded from the session on every authenticated request. */
export type Actor = {
  userId: string;
  email: string;
  emailVerified: boolean;
  isArchived: boolean;
  globalRoles: AppRole[];
  /** Accounts this user administers through account_admins. */
  adminAccountIds: string[];
};

/** Facts about one project needed to evaluate the project policy. */
export type ProjectScope = {
  projectId: string;
  accountId: string;
  archivedAt: Date | null;
  /** The caller's project_members role, or null when not a member. */
  memberRole: AppRole | null;
};

export type AccessStatus = "active" | "needs_onboarding" | "no_access" | "archived";
