import { db } from "../../database/client.js";
import { adfToText } from "../../integrations/atlassian/adf.js";
import type { Actor } from "../access/access.types.js";
import { findConnection } from "./connection.repository.js";
import { jiraConfig } from "./jira.config.js";
import { withJiraErrors } from "./jira.errors.js";
import { JiraSession } from "./jira-session.js";

type RawPerson = { displayName?: string } | null | undefined;

type RawIssue = {
  id: string;
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    issuetype?: { name?: string };
    priority?: { name?: string };
    assignee?: RawPerson;
    reporter?: RawPerson;
    created?: string;
    updated?: string;
    attachment?: {
      id: string;
      filename: string;
      mimeType?: string;
      size?: number;
      created?: string;
      author?: RawPerson;
      content: string;
    }[];
    timespent?: number | null;
    timeoriginalestimate?: number | null;
    comment?: {
      total?: number;
      comments?: { id: string; author?: RawPerson; created?: string; body?: unknown }[];
    };
    worklog?: {
      total?: number;
      worklogs?: {
        id: string;
        author?: RawPerson;
        started?: string;
        timeSpentSeconds?: number;
        comment?: unknown;
      }[];
    };
  };
};

type SearchPage = { issues?: RawIssue[]; total?: number; nextPageToken?: string };

const SEARCH_FIELDS =
  "summary,status,issuetype,priority,assignee,reporter,created,updated,attachment,description," +
  "comment,worklog,timespent,timeoriginalestimate";
const PAGE_SIZE = 100;

/** Not connected is a normal state for browsing, not an error. */
async function isConnected(userId: string) {
  jiraConfig();
  return (await findConnection(db, userId)) !== null;
}

export async function listProjects(actor: Actor) {
  if (!(await isConnected(actor.userId))) return [];
  type Raw = {
    values?: {
      id: string;
      key: string;
      name: string;
      projectTypeKey?: string;
      avatarUrls?: Record<string, string>;
    }[];
  };
  const data = await withJiraErrors(() =>
    new JiraSession(actor.userId).api<Raw>(
      "/rest/api/3/project/search?maxResults=100&orderBy=name",
    ),
  );
  return (data.values ?? []).map((p) => ({
    id: String(p.id),
    key: p.key,
    name: p.name,
    projectTypeKey: p.projectTypeKey ?? null,
    avatarUrl: p.avatarUrls?.["24x24"] ?? null,
  }));
}

function mapIssue(i: RawIssue) {
  const f = i.fields ?? {};
  return {
    id: String(i.id),
    key: i.key,
    summary: f.summary ?? "",
    status: f.status?.name ?? null,
    issueType: f.issuetype?.name ?? null,
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    created: f.created ?? null,
    updated: f.updated ?? null,
    attachments: (f.attachment ?? []).map((a) => ({
      id: String(a.id),
      filename: a.filename,
      mimeType: a.mimeType ?? "application/octet-stream",
      size: a.size ?? 0,
      created: a.created ?? "",
      author: a.author?.displayName ?? null,
      contentUrl: a.content,
    })),
    comments: (f.comment?.comments ?? []).map((c) => ({
      id: String(c.id),
      author: c.author?.displayName ?? null,
      created: c.created ?? null,
      body: adfToText(c.body).trim(),
    })),
    commentTotal: f.comment?.total ?? (f.comment?.comments ?? []).length,
    worklogs: (f.worklog?.worklogs ?? []).map((w) => ({
      id: String(w.id),
      author: w.author?.displayName ?? null,
      started: w.started ?? null,
      timeSpentSeconds: w.timeSpentSeconds ?? 0,
      comment: adfToText(w.comment).trim(),
    })),
    worklogTotal: f.worklog?.total ?? (f.worklog?.worklogs ?? []).length,
    timeSpentSeconds: f.timespent ?? 0,
    originalEstimateSeconds: f.timeoriginalestimate ?? null,
  };
}

/** Issues of one project, newest first, gathered across pages up to `maxResults`. */
export async function searchIssues(
  actor: Actor,
  input: { projectKey: string; query?: string | undefined; maxResults: number },
) {
  if (!(await isConnected(actor.userId))) return { issues: [], total: 0 };
  const session = new JiraSession(actor.userId);
  const escaped = (input.query ?? "").replace(/["\\]/g, " ").trim();
  const jql =
    `project = "${input.projectKey}"` +
    (escaped ? ` AND text ~ "${escaped}"` : "") +
    " ORDER BY updated DESC";

  return withJiraErrors(async () => {
    const collected: ReturnType<typeof mapIssue>[] = [];
    let reportedTotal: number | undefined;
    let useLegacy = false;
    let token: string | undefined;
    // Token-paged search endpoint first.
    for (let page = 0; page < 60 && collected.length < input.maxResults; page += 1) {
      const params = new URLSearchParams({
        jql,
        fields: SEARCH_FIELDS,
        maxResults: String(PAGE_SIZE),
      });
      if (token) params.set("nextPageToken", token);
      let raw: SearchPage;
      try {
        raw = await session.api<SearchPage>(`/rest/api/3/search/jql?${params.toString()}`);
      } catch {
        useLegacy = true;
        break;
      }
      const batch = raw.issues ?? [];
      collected.push(...batch.map(mapIssue));
      if (typeof raw.total === "number") reportedTotal = raw.total;
      token = raw.nextPageToken;
      if (!token || batch.length === 0) break;
    }
    // Older Jira Cloud sites still serve the legacy startAt-paged search.
    if (useLegacy) {
      collected.length = 0;
      for (let startAt = 0; startAt < input.maxResults; startAt += PAGE_SIZE) {
        const params = new URLSearchParams({
          jql,
          fields: SEARCH_FIELDS,
          maxResults: String(PAGE_SIZE),
          startAt: String(startAt),
        });
        const raw = await session.api<SearchPage>(`/rest/api/3/search?${params.toString()}`);
        const batch = raw.issues ?? [];
        collected.push(...batch.map(mapIssue));
        if (typeof raw.total === "number") reportedTotal = raw.total;
        if (batch.length < PAGE_SIZE) break;
      }
    }
    return { issues: collected, total: reportedTotal ?? collected.length };
  });
}
