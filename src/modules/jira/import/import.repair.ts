import { db } from "../../../database/client.js";
import { ConflictError } from "../../../shared/http/errors.js";
import type { Actor } from "../../access/access.types.js";
import { writeAuditEvent } from "../../audit/audit.service.js";
import { requireAccountAdmin } from "../jira.access.js";
import { isConnectionError, withJiraErrors } from "../jira.errors.js";
import { JiraSession } from "../jira-session.js";
import { loadImport } from "./import.service.js";
import * as records from "./issue-records.repository.js";
import type { JiraPerson } from "./import.types.js";

type Unresolved = { accountId: string | null; name: string; worklogs: number };

/** Jira authors of an issue's comments or work logs, by Jira id (bounded paging). */
async function authorsById(
  session: JiraSession,
  issueKey: string,
  kind: "comment" | "worklog",
): Promise<Map<string, JiraPerson>> {
  const out = new Map<string, JiraPerson>();
  for (let startAt = 0; startAt < 2000; startAt += 100) {
    type Page = { comments?: { id: string; author?: JiraPerson }[] } & {
      worklogs?: { id: string; author?: JiraPerson }[];
    };
    const page: Page = await session
      .api<Page>(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/${kind}?startAt=${startAt}&maxResults=100`,
      )
      .catch((error: unknown) => {
        if (isConnectionError(error)) throw error;
        return {};
      });
    const items = (kind === "comment" ? page.comments : page.worklogs) ?? [];
    for (const item of items) if (item.author) out.set(String(item.id), item.author);
    if (items.length < 100) break;
  }
  return out;
}

/**
 * Re-points imported comments and time logs at the users their Jira authors were matched to.
 * Pages through imported tickets (`afterTicketId`, `limit`) so the client can run it in slices.
 */
export async function repairAttribution(
  actor: Actor,
  importId: string,
  options: { afterTicketId: string | null; limit: number },
) {
  const row = await loadImport(actor, importId);
  await requireAccountAdmin(actor, row.accountId);
  if (!row.projectId)
    throw new ConflictError("This import has no project yet.", "JIRA_IMPORT_NO_PROJECT");
  const projectId = row.projectId;

  const byAccount = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const entry of row.jiraUsers) {
    if (!entry.userId) continue;
    if (entry.accountId) byAccount.set(entry.accountId, entry.userId);
    if (entry.name) byName.set(entry.name.trim().toLowerCase(), entry.userId);
  }
  const resolve = (author: JiraPerson | undefined): string | null => {
    if (!author) return null;
    if (author.accountId && byAccount.has(author.accountId))
      return byAccount.get(author.accountId) ?? null;
    const name = (author.displayName ?? "").trim().toLowerCase();
    return name ? (byName.get(name) ?? null) : null;
  };

  const limit = Math.min(Math.max(options.limit, 1), 100);
  const session = new JiraSession(actor.userId, row.cloudId);
  const tickets = await records.jiraTicketsPage(db, projectId, options.afterTicketId, limit);
  let comments = 0;
  let worklogs = 0;
  const unresolved = new Map<string, Unresolved>();

  await withJiraErrors(async () => {
    for (const ticket of tickets) {
      const issueKey = ticket.jiraIssueKey!;
      const localLogs = await records.jiraWorklogs(db, [ticket.id]);
      if (localLogs.length > 0) {
        const authors = await authorsById(session, issueKey, "worklog");
        for (const log of localLogs) {
          const author = authors.get(String(log.jiraWorklogId));
          const target = resolve(author);
          if (!target && author) {
            const accountId = author.accountId ?? null;
            const name = author.displayName?.trim() || "Unknown Jira user";
            const key = accountId ?? `name:${name.toLowerCase()}`;
            const current = unresolved.get(key);
            unresolved.set(key, { accountId, name, worklogs: (current?.worklogs ?? 0) + 1 });
          }
          if (!target || target === log.userId) continue;
          await records.updateWorklog(db, log.id, { userId: target });
          worklogs += 1;
        }
      }

      const localComments = await records.jiraComments(db, [ticket.id]);
      if (localComments.length > 0) {
        const authors = await authorsById(session, issueKey, "comment");
        for (const comment of localComments) {
          const author = authors.get(String(comment.jiraCommentId));
          const target = resolve(author);
          if (!target || target === comment.authorId) continue;
          // Drop the "Name (from Jira): " marker now that the real author is known.
          const prefix = `${author?.displayName ?? ""} (from Jira): `;
          const body =
            author?.displayName && comment.body.startsWith(prefix)
              ? comment.body.slice(prefix.length)
              : comment.body;
          await records.updateComment(db, comment.id, { authorId: target, body });
          comments += 1;
        }
      }
    }
  });

  const result = {
    done: tickets.length < limit,
    lastTicketId: tickets.at(-1)?.id ?? null,
    comments,
    worklogs,
    unresolvedAuthors: Array.from(unresolved.values()),
  };
  // The client walks tickets in pages; audit once, when the pass finishes.
  if (result.done) {
    await writeAuditEvent({
      actorUserId: actor.userId,
      action: "update",
      event: "jira.attribution_repaired",
      table: "work_logs",
      entityId: row.id,
      projectId,
      link: "/jira",
      summary: "Re-attributed imported comments and time logs",
      metadata: { comments, worklogs },
    });
  }
  return result;
}
