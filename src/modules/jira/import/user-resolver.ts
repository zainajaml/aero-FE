import { db } from "../../../database/client.js";
import { logger } from "../../../shared/observability/logger.js";
import { displayNameFromEmail } from "../../users/names.js";
import type { JiraSession } from "../jira-session.js";
import * as identities from "./identities.repository.js";
import { normalizeEmail } from "./import.mapping.js";
import { addMember } from "./project-setup.repository.js";
import type { JiraPerson, JiraUserEntry } from "./import.types.js";

const VALID_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function entryKey(user: JiraPerson, name: string | null) {
  return user.accountId ? `acct:${user.accountId}` : `name:${(name ?? "").toLowerCase()}`;
}

/**
 * Maps Jira people onto local identities, one entry per unique person. Identity work runs one
 * call at a time even when tickets are processed in parallel, so nobody is created twice.
 */
export class UserResolver {
  private entries = new Map<string, JiraUserEntry>();
  private emailByAccount = new Map<string, string>();
  private warnings: string[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly projectId: string,
    private readonly importerId: string,
    private readonly session: JiraSession,
    existing: JiraUserEntry[] = [],
  ) {
    for (const e of existing) this.entries.set(e.key, { ...e, ticketIds: e.ticketIds ?? [] });
  }

  get allEntries() {
    return Array.from(this.entries.values());
  }

  get newWarnings() {
    return this.warnings;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Local user for a Jira person, or null when unknown (assignees, reporters). */
  resolve(user: JiraPerson | null | undefined): Promise<string | null> {
    return this.serialize(() => this.resolveNow(user));
  }

  /**
   * Author for comments and time logs: the matched user, else a placeholder identity carrying the
   * Jira person's name — never the importer, so nobody is credited with work they did not do.
   */
  resolveAuthor(user: JiraPerson | null | undefined): Promise<string | null> {
    return this.serialize(() => this.resolveAuthorNow(user));
  }

  /** Remembers that a ticket belongs to an unmatched Jira person (for one-step manual matching). */
  noteTicket(user: JiraPerson | null | undefined, ticketId: string) {
    if (!user) return;
    const name = (user.displayName ?? "").trim() || null;
    const entry = this.entries.get(entryKey(user, name));
    if (!entry || entry.status !== "unmatched") return;
    if (!entry.ticketIds.includes(ticketId)) entry.ticketIds.push(ticketId);
  }

  private async resolveNow(user: JiraPerson | null | undefined): Promise<string | null> {
    if (!user) return null;
    const name = (user.displayName ?? "").trim() || null;
    const key = entryKey(user, name);
    if (key === "name:") return null;
    const known = this.entries.get(key);
    if (known) return known.userId;

    let email = normalizeEmail(user.emailAddress);
    if (!email && user.accountId) email = await this.lookupEmail(user.accountId);
    if (email && !VALID_EMAIL.test(email)) email = "";

    const entry: JiraUserEntry = {
      key,
      accountId: user.accountId ?? null,
      name,
      email: email || null,
      status: "unmatched",
      userId: null,
      ticketIds: [],
    };

    if (email) {
      const found = await identities.profileIdByEmail(db, email);
      if (found) {
        entry.userId = found;
        entry.status = "matched";
      } else {
        const created = await this.createProvisional(email, name);
        if (created) {
          entry.userId = created;
          entry.status = "invitable";
        }
      }
    } else if (name) {
      // Jira hides some emails; one exact display-name match is accepted before asking.
      const byName = await identities.profileIdsByName(db, name);
      if (byName.length === 1) {
        entry.userId = byName[0]!;
        entry.status = "matched";
      }
    }

    this.entries.set(key, entry);
    if (entry.userId) await this.ensureMember(entry.userId);
    return entry.userId;
  }

  private async resolveAuthorNow(user: JiraPerson | null | undefined): Promise<string | null> {
    const matched = await this.resolveNow(user);
    if (matched) return matched;
    if (!user) return null;
    const name = (user.displayName ?? "").trim() || null;
    const entry = this.entries.get(entryKey(user, name));
    if (!entry) return null;
    if (entry.placeholderId) return entry.placeholderId;
    const handle = (user.accountId ?? name ?? "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
    if (!handle) return null;
    const created = await this.createProvisional(
      `jira-${handle.slice(0, 60)}@jira-import.invalid`,
      name,
    );
    entry.placeholderId = created;
    if (created) await this.ensureMember(created);
    return created;
  }

  /** Jira hides emails unless the app has read:jira-user and the user allows it. */
  private async lookupEmail(accountId: string): Promise<string> {
    const cached = this.emailByAccount.get(accountId);
    if (cached !== undefined) return cached;
    let found = "";
    for (const path of [
      `/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`,
      `/rest/api/3/user/email?accountId=${encodeURIComponent(accountId)}`,
    ]) {
      try {
        const data = await this.session.api<{
          emailAddress?: string | null;
          email?: string | null;
        }>(path);
        found = normalizeEmail(data?.emailAddress ?? data?.email);
        if (found) break;
      } catch {
        // Missing scope or privacy restriction: try the next endpoint.
      }
    }
    this.emailByAccount.set(accountId, found);
    return found;
  }

  private async ensureMember(userId: string) {
    if (userId === this.importerId) return;
    await addMember(db, this.projectId, userId, "team", "keep");
  }

  private async createProvisional(email: string, name: string | null): Promise<string | null> {
    try {
      return await identities.createProvisionalUser(db, email, name ?? displayNameFromEmail(email));
    } catch {
      // No error details: driver messages can contain the email address.
      logger.warn("jira import could not create a provisional user");
      this.warnings.push(`Could not create a user for ${email}.`);
      return null;
    }
  }
}
