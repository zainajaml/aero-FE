import { db } from "../../database/client.js";
import { listColumns } from "../board/board.service.js";
import { listEpics } from "../epics/epics.service.js";
import { listProjectPeople } from "../projects/projects.service.js";
import { listSprints } from "../sprints/sprints.service.js";
import * as policy from "../access/access.policy.js";
import { requireProjectMember, visibleProjectIds } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import { ToolError } from "./mcp.errors.js";
import * as repo from "./mcp.repository.js";

/**
 * Account/project resolution and ticket metadata for MCP tools, always evaluated for the actor the
 * access token belongs to. `account_id` / project ids, keys and names are filters, never grants:
 * a project the actor cannot see behaves exactly like one that does not exist.
 */

export type ProjectSummary = repo.ProjectSummaryRow;

const PROJECT_NOT_FOUND = "Project not found, or you do not have access to it.";

export const PROJECT_PAGE_DEFAULT = 25;
export const PROJECT_PAGE_MAX = 50;

export const TICKET_TYPES = ["task", "bug", "story", "epic"] as const;
export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID_RE.test(value);

type ProjectFilters = { accountId?: string | undefined; query?: string | undefined };

/** Accessible, non-archived projects ordered by name. */
export async function listAccessibleProjects(
  actor: Actor,
  filters: ProjectFilters = {},
): Promise<ProjectSummary[]> {
  return repo.listProjects(db, await visibleProjectIds(actor), filters);
}

/** One page of accessible projects, filtered and windowed by the database. */
export async function listAccessibleProjectsPage(
  actor: Actor,
  filters: ProjectFilters & { limit?: number | undefined; offset?: number | undefined } = {},
): Promise<{ projects: ProjectSummary[]; limit: number; offset: number; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? PROJECT_PAGE_DEFAULT, 1), PROJECT_PAGE_MAX);
  const offset = Math.max(filters.offset ?? 0, 0);
  const { rows, total } = await repo.listProjectsPage(db, await visibleProjectIds(actor), filters, {
    limit,
    offset,
  });
  return { projects: rows, limit, offset, total };
}

/** Resolves an id, key or name to a project the actor can read; ambiguity is reported, not guessed. */
export async function resolveProject(actor: Actor, ref: string): Promise<ProjectSummary> {
  const value = ref.trim();
  if (!value) throw new ToolError("A project id, key or name is required.");
  const projects = await listAccessibleProjects(actor);

  if (isUuid(value)) {
    const byId = projects.find((p) => p.id === value);
    if (!byId) throw new ToolError(PROJECT_NOT_FOUND);
    return byId;
  }
  const lower = value.toLowerCase();
  const byKey = projects.find((p) => p.key.toLowerCase() === lower);
  if (byKey) return byKey;
  const exact = projects.filter((p) => p.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0]!;
  const partial = projects.filter((p) => p.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new ToolError(
      `"${value}" matches several projects: ${partial
        .map((p) => `${p.name} (${p.key})`)
        .join(", ")}. Ask which one to use.`,
    );
  }
  throw new ToolError(PROJECT_NOT_FOUND);
}

/** The app's write rule (member, not a viewer), re-checked before any write; createTicket re-checks. */
export async function assertCanCreateTickets(actor: Actor, projectId: string): Promise<void> {
  let scope;
  try {
    scope = await requireProjectMember(actor, projectId);
  } catch {
    throw new ToolError(PROJECT_NOT_FOUND);
  }
  if (policy.isProjectViewer(actor, scope)) {
    throw new ToolError("You have view-only access to this project and cannot create tickets.");
  }
}

export type MetadataKind = "types" | "priorities" | "statuses" | "epics" | "sprints" | "members";
export const METADATA_KINDS: readonly MetadataKind[] = [
  "types",
  "priorities",
  "statuses",
  "epics",
  "sprints",
  "members",
];

export type ProjectMetadata = {
  statuses: { id: string; name: string; is_done: boolean; order_index: number }[];
  epics: { id: string; name: string }[];
  sprints: {
    id: string;
    name: string;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
    is_current: boolean;
  }[];
  members: { user_id: string; name: string; email: string | null; role: string }[];
  ticket_types: string[];
  priorities: string[];
};

function isCurrentSprint(row: {
  status: string;
  starts_at: string | null;
  ends_at: string | null;
}) {
  if (row.status === "active") return true;
  if (row.status === "completed") return false;
  const now = Date.now();
  const start = row.starts_at ? Date.parse(row.starts_at) : null;
  const end = row.ends_at ? Date.parse(row.ends_at) : null;
  return start !== null && end !== null && now >= start && now <= end;
}

/** Valid ticket field values for one project, read through the same services the app uses. */
export async function loadProjectMetadata(
  actor: Actor,
  projectId: string,
  kinds: readonly string[] = METADATA_KINDS,
): Promise<Partial<ProjectMetadata>> {
  const want = new Set(kinds);
  const out: Partial<ProjectMetadata> = {};
  const jobs: Promise<void>[] = [];

  if (want.has("statuses")) {
    jobs.push(
      listColumns(actor, projectId).then((columns) => {
        out.statuses = columns.map((c) => ({
          id: c.id,
          name: c.name,
          is_done: c.isDone,
          order_index: c.orderIndex,
        }));
      }),
    );
  }
  if (want.has("epics")) {
    jobs.push(
      listEpics(actor, projectId).then((epics) => {
        out.epics = epics.map((e) => ({ id: e.id, name: e.name }));
      }),
    );
  }
  if (want.has("sprints")) {
    jobs.push(
      listSprints(actor, projectId).then((sprints) => {
        out.sprints = sprints.map((s) => {
          const row = { status: s.status, starts_at: s.startsAt, ends_at: s.endsAt };
          return { id: s.id, name: s.name, ...row, is_current: isCurrentSprint(row) };
        });
      }),
    );
  }
  if (want.has("members")) {
    jobs.push(
      (async () => {
        // Same source of truth as the app's assignee pickers: project members plus admins of the
        // owning account, archived users excluded.
        const people = await listProjectPeople(actor, projectId);
        const emails = await repo.profileEmails(
          db,
          people.map((p) => p.userId),
        );
        const seen = new Set<string>();
        out.members = people
          .filter((p) => {
            if (seen.has(p.userId)) return false;
            seen.add(p.userId);
            return true;
          })
          .map((p) => {
            const email = emails.get(p.userId) ?? null;
            const name =
              p.fullName?.trim() ||
              [p.firstName, p.lastName].filter(Boolean).join(" ").trim() ||
              email ||
              "Unknown";
            return { user_id: p.userId, name, email, role: String(p.role ?? "member") };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
      })(),
    );
  }

  if (want.has("types")) out.ticket_types = [...TICKET_TYPES];
  if (want.has("priorities")) out.priorities = [...TICKET_PRIORITIES];

  await Promise.all(jobs);
  return out;
}

/** Matches a human-readable value against `{ id, name }` rows: id, exact name, unique partial name. */
export function matchByName<T extends { id: string; name: string }>(
  rows: T[],
  ref: string,
  label: string,
): T {
  const value = ref.trim();
  const lower = value.toLowerCase();
  if (isUuid(value)) {
    const byId = rows.find((r) => r.id === value);
    if (!byId) throw new ToolError(`That ${label} does not belong to this project.`);
    return byId;
  }
  const exact = rows.filter((r) => r.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0]!;
  const partial = rows.filter((r) => r.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new ToolError(
      `"${value}" matches several ${label}s: ${partial.map((r) => r.name).join(", ")}.`,
    );
  }
  throw new ToolError(
    `No ${label} named "${value}" in this project. Valid options: ${
      rows.map((r) => r.name).join(", ") || "none"
    }.`,
  );
}

/** Matches a member by email, id or name within the project's member list. */
export function matchMember(
  members: ProjectMetadata["members"],
  ref: string,
): ProjectMetadata["members"][number] {
  const lower = ref.trim().toLowerCase();
  const byEmail = members.find((m) => (m.email ?? "").toLowerCase() === lower);
  if (byEmail) return byEmail;
  const byId = members.find((m) => m.user_id === ref.trim());
  if (byId) return byId;
  return matchByName(
    members.map((m) => ({ ...m, id: m.user_id })),
    ref,
    "project member",
  );
}
