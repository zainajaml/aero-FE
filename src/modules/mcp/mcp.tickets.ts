import { db } from "../../database/client.js";
import type { Actor } from "../access/access.types.js";
import { ticketUrl } from "./mcp.config.js";
import { ToolError } from "./mcp.errors.js";
import * as repo from "./mcp.repository.js";
import {
  isUuid,
  listAccessibleProjects,
  loadProjectMetadata,
  matchByName,
  matchMember,
  resolveProject,
  type ProjectMetadata,
  type ProjectSummary,
} from "./mcp.scope.js";

/**
 * Ticket reads for MCP tools. Queries are always confined to the projects the actor can read
 * (non-archived); project scoping from tool input is a filter on top of that.
 */

const TICKET_NOT_FOUND = "Ticket not found, or you do not have access to it.";

export const TICKET_PAGE_DEFAULT = 50;
export const TICKET_PAGE_MAX = 100;

/** Flattens a stored TipTap / legacy description into plain text. */
function descriptionToText(json: unknown, maxLength = 4000): string | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text.trim() || null;

  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (typeof n.text === "string") parts.push(n.text);
    if (n.type === "mention" || n.type === "docMention") {
      const attrs = (n.attrs ?? {}) as Record<string, unknown>;
      if (typeof attrs.label === "string") parts.push(`@${attrs.label}`);
    }
    if (Array.isArray(n.content)) {
      walk(n.content);
      if (n.type === "paragraph" || n.type === "heading" || n.type === "listItem") {
        parts.push("\n");
      }
    }
  };
  walk(obj.content ?? obj);
  const text = parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** Plain text / markdown to the app's rich-text document shape (one paragraph per line). */
export function textToDocumentJson(text: string): Record<string, unknown> {
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  return {
    type: "doc",
    content: paragraphs.map((line) =>
      line.trim().length
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : { type: "paragraph" },
    ),
  };
}

/** Accepts `"2h 30m"`, `"1d 4h"` (8h days), `"90"` (minutes) or a number of minutes. */
export function parseEstimateMinutes(input: string | number | undefined | null): number {
  if (input === undefined || input === null || input === "") return 0;
  if (typeof input === "number") return Math.max(0, Math.round(input));
  const text = String(input).trim().toLowerCase();
  if (/^\d+$/.test(text)) return Math.max(0, parseInt(text, 10));
  let minutes = 0;
  let found = false;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m)/g)) {
    found = true;
    const n = parseFloat(m[1]!);
    const unit = m[2];
    minutes += unit === "d" ? n * 8 * 60 : unit === "h" ? n * 60 : n;
  }
  if (!found) {
    throw new ToolError(`Could not read the estimate "${input}". Use e.g. "2h 30m" or "1d".`);
  }
  return Math.round(minutes);
}

export type TicketFilters = {
  status?: string | undefined;
  priority?: string | undefined;
  ticket_type?: string | undefined;
  assignee?: string | undefined;
  sprint?: string | undefined;
  epic?: string | undefined;
  query?: string | undefined;
  due_before?: string | undefined;
  due_after?: string | undefined;
  overdue?: boolean | undefined;
  open_only?: boolean | undefined;
  released?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

export type PageInfo = {
  limit: number;
  offset: number;
  total: number;
  returned: number;
  has_more: boolean;
  next_offset: number | null;
};

export function buildPageInfo(
  limit: number,
  offset: number,
  total: number,
  returned: number,
): PageInfo {
  const hasMore = offset + returned < total;
  return {
    limit,
    offset,
    total,
    returned,
    has_more: hasMore,
    next_offset: hasMore ? offset + returned : null,
  };
}

export function describePage(page: PageInfo): string {
  if (!page.total) return "";
  const from = page.offset + 1;
  const to = page.offset + page.returned;
  return page.has_more
    ? ` (showing ${from}-${to} of ${page.total}; request the next page with offset=${page.next_offset})`
    : ` (showing ${from}-${to} of ${page.total})`;
}

export type TicketView = {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  project: { id: string; name: string; key: string };
  status: string | null;
  is_done: boolean | null;
  priority: string;
  ticket_type: string;
  assignee: { user_id: string; name: string; email: string | null } | null;
  sprint: { id: string; name: string; status: string; is_current: boolean } | null;
  epics: { id: string; name: string }[];
  estimate_minutes: number;
  logged_minutes: number | null;
  story_points: number | null;
  due_date: string | null;
  is_overdue: boolean;
  released: boolean;
  created_at: string;
  updated_at: string;
  url: string;
};

type Metadata = Partial<ProjectMetadata>;

/** Resolves the set of projects a ticket query runs against. */
export async function resolveTicketScope(
  actor: Actor,
  opts: { project?: string | undefined; account_id?: string | undefined },
): Promise<ProjectSummary[]> {
  if (opts.project) return [await resolveProject(actor, opts.project)];
  const projects = await listAccessibleProjects(actor, { accountId: opts.account_id });
  if (!projects.length) {
    throw new ToolError(
      opts.account_id
        ? "No accessible projects in that account."
        : "You do not have access to any SpaceScope projects yet.",
    );
  }
  return projects;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * One page of tickets for the given projects. Name filters (status/assignee/sprint/epic) are only
 * resolvable per project, so they require a single-project scope.
 */
export async function queryTickets(
  actor: Actor,
  projects: ProjectSummary[],
  filters: TicketFilters,
  opts: { includeDescription?: boolean } = {},
): Promise<{ tickets: TicketView[]; page: PageInfo }> {
  const limit = Math.min(Math.max(filters.limit ?? TICKET_PAGE_DEFAULT, 1), TICKET_PAGE_MAX);
  const offset = Math.max(filters.offset ?? 0, 0);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const singleProject = projects.length === 1 ? projects[0]! : null;

  const needsSingle = (["status", "assignee", "sprint", "epic"] as const).filter((k) => filters[k]);
  if (needsSingle.length && !singleProject) {
    throw new ToolError(
      `Filtering by ${needsSingle.join(", ")} needs one project — pass \`project\` as well, since those values are per project.`,
    );
  }

  // Per-project metadata, used both to resolve filters and to label the results.
  const metaByProject = new Map<string, Metadata>();
  await Promise.all(
    projects.map(async (p) => {
      metaByProject.set(p.id, await loadProjectMetadata(actor, p.id));
    }),
  );

  let columnIds: string[] | null = null;
  let sprintId: string | null = null;
  let assignee: string | null = null;
  let epicId: string | null = null;

  if (singleProject) {
    const meta = metaByProject.get(singleProject.id) ?? {};
    if (filters.status) {
      columnIds = [matchByName(meta.statuses ?? [], filters.status, "status").id];
    }
    if (filters.sprint) {
      const sprints = meta.sprints ?? [];
      const wanted = filters.sprint.toLowerCase();
      const sprint =
        wanted === "current" || wanted === "active"
          ? sprints.find((s) => s.is_current)
          : matchByName(sprints, filters.sprint, "sprint");
      if (!sprint) throw new ToolError("This project has no active sprint.");
      sprintId = sprint.id;
    }
    if (filters.assignee) {
      const value = filters.assignee.trim().toLowerCase();
      if (value === "me") assignee = actor.userId;
      else if (value === "unassigned") assignee = "unassigned";
      else assignee = matchMember(meta.members ?? [], filters.assignee).user_id;
    }
    if (filters.epic) epicId = matchByName(meta.epics ?? [], filters.epic, "epic").id;
  }

  // Done columns are per project; excluded in the query so counts and the page window agree.
  const doneColumnIds = filters.open_only
    ? projects.flatMap((p) =>
        (metaByProject.get(p.id)?.statuses ?? []).filter((s) => s.is_done).map((s) => s.id),
      )
    : null;

  const { rows, total } = await repo.queryTickets(db, {
    projectIds: projects.map((p) => p.id),
    priority: filters.priority,
    type: filters.ticket_type,
    released: filters.released,
    columnIds,
    sprintId,
    assignee,
    epicId,
    overdueBefore: filters.overdue ? today() : null,
    dueBefore: filters.due_before,
    dueAfter: filters.due_after,
    query: filters.query,
    excludeColumnIds: doneColumnIds,
    limit,
    offset,
  });

  const tickets = await buildTicketViews(rows, projectById, metaByProject, {
    includeDescription: opts.includeDescription ?? false,
  });
  return { tickets, page: buildPageInfo(limit, offset, total, rows.length) };
}

async function buildTicketViews(
  rows: repo.TicketRow[],
  projectById: Map<string, ProjectSummary>,
  metaByProject: Map<string, Metadata>,
  opts: { includeDescription: boolean },
): Promise<TicketView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [links, logged] = await Promise.all([repo.epicLinks(db, ids), repo.loggedMinutes(db, ids)]);
  const epicsByTicket = new Map<string, Set<string>>();
  for (const link of links) {
    const set = epicsByTicket.get(link.ticketId) ?? new Set<string>();
    set.add(link.epicId);
    epicsByTicket.set(link.ticketId, set);
  }
  const stamp = today();

  return rows.map((r) => {
    const project = projectById.get(r.projectId);
    const meta = metaByProject.get(r.projectId) ?? {};
    const column = (meta.statuses ?? []).find((s) => s.id === r.columnId);
    const sprint = (meta.sprints ?? []).find((s) => s.id === r.sprintId);
    const member = (meta.members ?? []).find((m) => m.user_id === r.assigneeId);
    const epicIds = epicsByTicket.get(r.id) ?? new Set<string>();
    const view: TicketView = {
      id: r.id,
      code: r.code,
      title: r.title,
      project: {
        id: r.projectId,
        name: project?.name ?? "Unknown",
        key: project?.key ?? r.code.split("-")[0] ?? "",
      },
      status: column?.name ?? null,
      is_done: column ? column.is_done : null,
      priority: r.priority,
      ticket_type: r.type,
      assignee: member ? { user_id: member.user_id, name: member.name, email: member.email } : null,
      sprint: sprint
        ? { id: sprint.id, name: sprint.name, status: sprint.status, is_current: sprint.is_current }
        : null,
      epics: (meta.epics ?? []).filter((e) => epicIds.has(e.id)),
      estimate_minutes: r.estimateMinutes,
      logged_minutes: logged.get(r.id) ?? 0,
      story_points: r.storyPoints,
      due_date: r.dueDate,
      is_overdue: Boolean(r.dueDate && r.dueDate < stamp && !column?.is_done),
      released: r.released,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
      url: ticketUrl(r.id),
    };
    if (opts.includeDescription) view.description = descriptionToText(r.descriptionJson);
    return view;
  });
}

/** One ticket by code or id; not-found and no-access are deliberately the same message. */
export async function findTicket(actor: Actor, ref: string): Promise<TicketView> {
  const value = ref.trim();
  if (!value) throw new ToolError("A ticket code or id is required.");
  const projects = await listAccessibleProjects(actor);
  const row = await repo.findTicket(
    db,
    projects.map((p) => p.id),
    isUuid(value) ? { id: value } : { code: value },
  );
  const project = row ? projects.find((p) => p.id === row.projectId) : undefined;
  if (!row || !project) throw new ToolError(TICKET_NOT_FOUND);

  const meta = await loadProjectMetadata(actor, project.id);
  const [view] = await buildTicketViews(
    [row],
    new Map([[project.id, project]]),
    new Map([[project.id, meta]]),
    { includeDescription: true },
  );
  return view!;
}

/** Compact one-line rendering used in the tools' text content. */
export function formatTicketLine(t: TicketView): string {
  const bits = [
    `${t.code} — ${t.title}`,
    t.status ?? "no status",
    t.priority,
    t.ticket_type,
    t.assignee ? t.assignee.name : "unassigned",
  ];
  if (t.sprint) bits.push(t.sprint.name);
  if (t.due_date) bits.push(`due ${t.due_date}${t.is_overdue ? " (overdue)" : ""}`);
  return bits.join(" | ");
}
