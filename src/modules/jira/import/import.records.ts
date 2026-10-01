import { db } from "../../../database/client.js";
import { adfToText } from "../../../integrations/atlassian/adf.js";
import { deleteObjects, putObject } from "../../../integrations/storage/object-storage.js";
import { logger } from "../../../shared/observability/logger.js";
import { MB, objectKeyFor } from "../../files/upload.js";
import { isConnectionError } from "../jira.errors.js";
import type { JiraSession } from "../jira-session.js";
import * as records from "./issue-records.repository.js";
import type { JiraIssueRecord } from "./import.types.js";
import type { UserResolver } from "./user-resolver.js";

const MAX_ATTACHMENT_BYTES = 25 * MB;

const toDate = (value: string | undefined) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

/** Imports new comments and refreshes the text of ones imported earlier. Returns new count. */
export async function importComments(
  ticketId: string,
  issue: JiraIssueRecord,
  resolver: UserResolver,
  importerId: string,
  have: Map<string, { id: string; body: string }>,
): Promise<number> {
  let count = 0;
  for (const c of issue.fields.comment?.comments ?? []) {
    const text = adfToText(c.body).trim();
    if (!text) continue;
    const already = have.get(String(c.id));
    if (already) {
      // Keep any "Name (from Jira): " attribution prefix already stored.
      const prefix = already.body.match(/^.{1,120}? \(from Jira\): /)?.[0] ?? "";
      if (already.body.slice(prefix.length) !== text)
        await records.updateComment(db, already.id, { body: `${prefix}${text}` });
      continue;
    }
    const authorId = await resolver.resolveAuthor(c.author);
    const prefix = authorId ? "" : `${c.author?.displayName ?? "Jira user"} (from Jira): `;
    const inserted = await records.insertComment(db, {
      ticketId,
      authorId: authorId ?? importerId,
      body: `${prefix}${text}`,
      createdAt: toDate(c.created),
      jiraCommentId: String(c.id),
    });
    if (inserted) count += 1;
  }
  return count;
}

/** Time is only recorded against the Jira author (or their stand-in), never the importer. */
export async function importWorklogs(
  ticketId: string,
  issue: JiraIssueRecord,
  resolver: UserResolver,
  have: Map<string, { id: string; note: string | null }>,
): Promise<number> {
  let count = 0;
  for (const w of issue.fields.worklog?.worklogs ?? []) {
    const note = adfToText(w.comment).trim();
    const already = have.get(String(w.id));
    if (already) {
      if (note && note !== already.note) await records.updateWorklog(db, already.id, { note });
      continue;
    }
    const minutes = Math.round((w.timeSpentSeconds ?? 0) / 60);
    if (minutes <= 0) continue;
    const authorId = await resolver.resolveAuthor(w.author);
    if (!authorId) continue;
    const inserted = await records.insertWorklog(db, {
      ticketId,
      userId: authorId,
      minutes,
      note: note || null,
      loggedAt: toDate(w.started),
      resourceType: "developer",
      jiraWorklogId: String(w.id),
    });
    if (inserted) count += 1;
  }
  return count;
}

/** Downloads new attachments into object storage (`<ticketId>/<uuid>-<name>`). */
export async function importAttachments(
  session: JiraSession,
  ticketId: string,
  issue: JiraIssueRecord,
  have: Set<string>,
): Promise<{ count: number; warnings: string[] }> {
  const warnings: string[] = [];
  let count = 0;
  for (const a of issue.fields.attachment ?? []) {
    if (have.has(String(a.id))) continue;
    if ((a.size ?? 0) > MAX_ATTACHMENT_BYTES) {
      warnings.push(`${issue.key}: "${a.filename}" is too large to import.`);
      continue;
    }
    try {
      const file = await session.binary(a.content, MAX_ATTACHMENT_BYTES);
      const key = objectKeyFor(ticketId, a.filename);
      const contentType = a.mimeType || file.contentType || "application/octet-stream";
      await putObject("attachments", key, file.body, contentType);
      const inserted = await records
        .insertAttachment(db, {
          ticketId,
          storagePath: key,
          name: a.filename.slice(0, 255),
          mime: contentType,
          size: a.size ?? file.body.byteLength,
          uploadedBy: session.userId,
          context: "description",
          createdAt: toDate(a.created),
          jiraAttachmentId: String(a.id),
        })
        .catch(async (error: unknown) => {
          await deleteObjects("attachments", [key]).catch(() => undefined);
          throw error;
        });
      if (inserted) count += 1;
      else await deleteObjects("attachments", [key]).catch(() => undefined);
    } catch (error) {
      if (isConnectionError(error)) throw error;
      logger.warn({ issue: issue.key, status: statusOf(error) }, "jira attachment import failed");
      warnings.push(`${issue.key}: the file "${a.filename}" could not be imported.`);
    }
  }
  return { count, warnings };
}

const statusOf = (error: unknown) =>
  typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : null;
