import { db } from "../../../database/client.js";
import {
  adfToDocumentJson,
  adfToText,
  textToDocumentJson,
} from "../../../integrations/atlassian/adf.js";
import { logger } from "../../../shared/observability/logger.js";
import { isConnectionError } from "../jira.errors.js";
import type { JiraSession } from "../jira-session.js";
import * as imports from "./import.repository.js";
import { mapPriority, mapType, runBatched } from "./import.mapping.js";
import { importAttachments, importComments, importWorklogs } from "./import.records.js";
import * as records from "./issue-records.repository.js";
import { listColumns, listJiraSprints } from "./project-setup.repository.js";
import type { ImportRow, JiraIssueRecord } from "./import.types.js";
import { UserResolver } from "./user-resolver.js";

const ISSUES_PER_STEP = 50;

const ISSUE_FIELDS = [
  "summary",
  "description",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "created",
  "updated",
  "duedate",
  "timeoriginalestimate",
  "parent",
  "attachment",
  "comment",
  "worklog",
].join(",");

const DUE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ticketId → (Jira id → value). */
function byTicket<T extends { ticketId: string }, V>(
  rows: T[],
  jiraId: (row: T) => string,
  value: (row: T) => V,
) {
  const out = new Map<string, Map<string, V>>();
  for (const row of rows) {
    const bucket = out.get(row.ticketId) ?? new Map<string, V>();
    bucket.set(jiraId(row), value(row));
    out.set(row.ticketId, bucket);
  }
  return out;
}

/** Creates the ticket, retrying the code on a clash; reuses a row a concurrent step created. */
async function insertTicket(
  projectId: string,
  projectKey: string,
  issue: JiraIssueRecord,
  base: records.TicketFields,
  nextPosition: () => number,
): Promise<string> {
  const numeric = parseInt(issue.key.split("-").pop() ?? "", 10);
  let attempt = Number.isFinite(numeric) ? numeric : nextPosition();
  for (let i = 0; i < 6; i += 1) {
    const id = await records.tryInsertTicket(db, {
      ...base,
      code: `${projectKey}-${attempt}`,
      position: nextPosition(),
    });
    if (id) return id;
    const [existing] = await records.ticketsByJiraIds(db, projectId, [issue.id]);
    if (existing) return existing.id;
    attempt += 1;
  }
  throw new Error("ticket code allocation failed");
}

/** Imports one page of issues (tickets first, then comments, work logs and files). */
export async function runIssueSlice(session: JiraSession, row: ImportRow): Promise<ImportRow> {
  const userId = session.userId;
  const projectId = row.projectId!;
  const params = new URLSearchParams({
    jql: `project = "${row.jiraProjectKey}" ORDER BY created ASC`,
    fields: ISSUE_FIELDS,
    maxResults: String(ISSUES_PER_STEP),
  });
  if (row.pageToken) params.set("nextPageToken", row.pageToken);
  const page = await session.api<{ issues?: JiraIssueRecord[]; nextPageToken?: string }>(
    `/rest/api/3/search/jql?${params.toString()}`,
  );
  const issues = (page.issues ?? []).map((i) => ({
    ...i,
    id: String(i.id),
    fields: i.fields ?? {},
  }));

  const [columns, sprints, project] = await Promise.all([
    listColumns(db, projectId),
    listJiraSprints(db, projectId),
    imports.findProjectBrief(db, projectId),
  ]);
  const columnByName = new Map(columns.map((c) => [c.name.toLowerCase(), c.id]));
  const firstColumn = columns[0]?.id ?? null;
  const sprintByJira = new Map(sprints.map((s) => [String(s.jiraSprintId), s.id]));
  const projectKey = project?.key ?? row.jiraProjectKey;

  const resolver = new UserResolver(projectId, userId, session, row.jiraUsers);
  let comments = row.importedComments;
  let worklogs = row.importedWorklogs;
  let attachments = row.importedAttachments;
  const warnings: string[] = [];
  let position = (await records.maxTicketPosition(db, projectId)) + 1;
  const nextPosition = () => position++;

  const existing = await records.ticketsByJiraIds(
    db,
    projectId,
    issues.map((i) => i.id),
  );
  const ticketByIssue = new Map(existing.map((t) => [String(t.jiraIssueId), t.id]));
  const knownIds = Array.from(ticketByIssue.values());
  const [commentRows, worklogRows, attachmentRows, epicRows] = await Promise.all([
    records.jiraComments(db, knownIds),
    records.jiraWorklogs(db, knownIds),
    records.jiraAttachments(db, knownIds),
    records.jiraEpics(db, projectId),
  ]);
  const commentsByTicket = byTicket(
    commentRows,
    (c) => String(c.jiraCommentId),
    (c) => ({ id: c.id, body: c.body }),
  );
  const worklogsByTicket = byTicket(
    worklogRows,
    (w) => String(w.jiraWorklogId),
    (w) => ({ id: w.id, note: w.note }),
  );
  const attachmentsByTicket = new Map<string, Set<string>>();
  for (const a of attachmentRows) {
    const bucket = attachmentsByTicket.get(a.ticketId) ?? new Set<string>();
    bucket.add(String(a.jiraAttachmentId));
    attachmentsByTicket.set(a.ticketId, bucket);
  }
  const epicCache = new Map(epicRows.map((e) => [String(e.jiraIssueKey), e.id]));

  // Pass 1: ticket rows, sequential so codes and positions keep Jira's creation order.
  const prepared: { issue: JiraIssueRecord; ticketId: string }[] = [];
  const pendingUpdates: (() => Promise<void>)[] = [];
  for (const issue of issues) {
    try {
      const f = issue.fields;
      const assigneeId = await resolver.resolve(f.assignee);
      const reporterId = (await resolver.resolve(f.reporter)) ?? userId;
      const descriptionText = adfToText(f.description).trim();
      const base: records.TicketFields = {
        projectId,
        sprintId: sprintByJira.get(row.sprintMap[issue.key] ?? "") ?? null,
        columnId: columnByName.get((f.status?.name ?? "").toLowerCase()) ?? firstColumn,
        title: (f.summary ?? issue.key).slice(0, 200),
        descriptionJson:
          adfToDocumentJson(f.description) ??
          textToDocumentJson(descriptionText || `Imported from Jira ${issue.key}`),
        type: mapType(f.issuetype?.name),
        priority: mapPriority(f.priority?.name),
        assigneeId,
        reporterId,
        estimateMinutes: Math.max(0, Math.round((f.timeoriginalestimate ?? 0) / 60)),
        dueDate: f.duedate && DUE_DATE.test(f.duedate) ? f.duedate : null,
        jiraIssueId: issue.id,
        jiraIssueKey: issue.key,
      };
      const known = ticketByIssue.get(issue.id);
      let ticketId: string;
      if (known) {
        ticketId = known;
        pendingUpdates.push(() => records.updateTicket(db, known, base));
      } else {
        ticketId = await insertTicket(projectId, projectKey, issue, base, nextPosition);
      }
      // One manual match later reassigns every ticket of an unmatched Jira person.
      if (!assigneeId) resolver.noteTicket(f.assignee, ticketId);

      const parentType = (f.parent?.fields?.issuetype?.name ?? "").toLowerCase();
      if (f.parent?.key && parentType === "epic") {
        const epicId =
          epicCache.get(f.parent.key) ??
          (await records.ensureEpic(db, {
            projectId,
            jiraIssueKey: f.parent.key,
            name: (f.parent.fields?.summary ?? f.parent.key).slice(0, 80),
            createdBy: userId,
          }));
        if (epicId) {
          epicCache.set(f.parent.key, epicId);
          await records.linkEpic(db, ticketId, epicId);
        }
      }
      prepared.push({ issue, ticketId });
    } catch (error) {
      if (isConnectionError(error)) throw error;
      logger.warn({ issue: issue.key }, "jira issue import failed");
      warnings.push(`${issue.key} could not be imported.`);
    }
  }
  await runBatched(pendingUpdates, 8, (task) => task());

  // Pass 2: secondary data is best-effort per ticket; it never fails the whole import.
  await runBatched(prepared, 6, async ({ issue, ticketId }) => {
    const attempt = async (label: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        if (isConnectionError(error)) throw error;
        warnings.push(`${issue.key}: some ${label} could not be imported.`);
      }
    };
    await attempt("comments", async () => {
      comments += await importComments(
        ticketId,
        issue,
        resolver,
        userId,
        commentsByTicket.get(ticketId) ?? new Map(),
      );
    });
    await attempt("work logs", async () => {
      worklogs += await importWorklogs(
        ticketId,
        issue,
        resolver,
        worklogsByTicket.get(ticketId) ?? new Map(),
      );
    });
    await attempt("files", async () => {
      const result = await importAttachments(
        session,
        ticketId,
        issue,
        attachmentsByTicket.get(ticketId) ?? new Set(),
      );
      attachments += result.count;
      warnings.push(...result.warnings);
    });
  });

  const processed = row.processedIssues + issues.length;
  const nextToken = page.nextPageToken ?? null;
  const finished = !nextToken || issues.length === 0;
  const patch = {
    processedIssues: processed,
    totalIssues: Math.max(row.totalIssues, processed),
    pageToken: nextToken,
    phase: finished ? ("done" as const) : ("issues" as const),
    importedComments: comments,
    importedWorklogs: worklogs,
    importedAttachments: attachments,
    jiraUsers: resolver.allEntries,
    warnings: [...row.warnings, ...resolver.newWarnings, ...warnings].slice(-100),
    error: null,
  };
  await imports.patchImport(db, row.id, patch);
  return { ...row, ...patch };
}
