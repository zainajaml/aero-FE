import { db } from "../../../database/client.js";
import { AppError } from "../../../shared/http/errors.js";
import { defaultColumns, normalizeProjectKey } from "../../projects/project-defaults.js";
import * as projectsRepo from "../../projects/projects.repository.js";
import { isConnectionError } from "../jira.errors.js";
import type { JiraSession } from "../jira-session.js";
import * as imports from "./import.repository.js";
import { ARCHIVED_IMPORT_MESSAGE, ImportStoppedError, mapSprintStatus } from "./import.mapping.js";
import * as setupRepo from "./project-setup.repository.js";
import type { ImportProjectType, ImportRow, JiraSprintValue } from "./import.types.js";

type JiraBoard = { id: number; name?: string; type?: string };

/** Optional Jira data: failures fall back, except a lost connection or site, which stop the step. */
const quietly = <T>(promise: Promise<T>, fallback: T) =>
  promise.catch((error: unknown) => {
    if (isConnectionError(error) || error instanceof AppError) throw error;
    return fallback;
  });

async function fetchBoards(session: JiraSession, projectKey: string): Promise<JiraBoard[]> {
  const data = await quietly(
    session.api<{ values?: JiraBoard[] }>(
      `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=50`,
    ),
    { values: [] },
  );
  return data.values ?? [];
}

/** Workflow statuses in order, done-category last; project defaults when Jira returns none. */
async function fetchStatuses(
  session: JiraSession,
  projectKey: string,
  projectType: ImportProjectType,
) {
  type Raw = { statuses?: { name?: string; statusCategory?: { key?: string } }[] }[];
  const ordered: { name: string; isDone: boolean }[] = [];
  const data = await quietly(
    session.api<Raw>(`/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`),
    [],
  );
  for (const type of Array.isArray(data) ? data : []) {
    for (const s of type.statuses ?? []) {
      const name = (s.name ?? "").trim();
      if (!name || ordered.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
      ordered.push({ name, isDone: s.statusCategory?.key === "done" });
    }
  }
  if (ordered.length === 0) return defaultColumns(projectType);
  return [...ordered.filter((o) => !o.isDone), ...ordered.filter((o) => o.isDone)];
}

/**
 * Jira sometimes hides Agile boards from OAuth apps even though issues carry the Sprint custom
 * field; reading that field is the fallback for team-managed and restricted projects.
 */
async function fetchIssueSprints(session: JiraSession, projectKey: string) {
  const fields = await quietly(
    session.api<{ id?: string; name?: string; schema?: { custom?: string } }[]>(
      "/rest/api/3/field",
    ),
    [],
  );
  const sprintField = (Array.isArray(fields) ? fields : []).find(
    (field) =>
      field.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint" ||
      field.name?.trim().toLowerCase() === "sprint",
  )?.id;
  const byId = new Map<string, JiraSprintValue>();
  const sprintMap: Record<string, string> = {};
  if (!sprintField) return { sprints: [], sprintMap };

  let nextPageToken: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const params = new URLSearchParams({
      jql: `project = "${projectKey}"`,
      fields: `key,${sprintField}`,
      maxResults: "100",
    });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);
    type Page = {
      issues?: { key: string; fields?: Record<string, unknown> }[];
      nextPageToken?: string;
    };
    const result: Page = await quietly(
      session.api<Page>(`/rest/api/3/search/jql?${params.toString()}`),
      { issues: [] },
    );
    const issues = result.issues ?? [];
    for (const issue of issues) {
      const raw = issue.fields?.[sprintField];
      for (const value of Array.isArray(raw) ? raw : raw ? [raw] : []) {
        if (!value || typeof value !== "object") continue;
        const sprint = value as Partial<JiraSprintValue>;
        if (typeof sprint.id !== "number") continue;
        byId.set(String(sprint.id), { ...sprint, id: sprint.id });
        sprintMap[issue.key] = String(sprint.id);
      }
    }
    nextPageToken = result.nextPageToken ?? null;
    if (!nextPageToken || issues.length === 0) break;
  }
  return { sprints: Array.from(byId.values()), sprintMap };
}

async function uniqueProjectKey(base: string): Promise<string> {
  const cleaned = normalizeProjectKey(base) || "JIRA";
  for (let i = 0; i < 40; i += 1) {
    const candidate = i === 0 ? cleaned : `${cleaned.slice(0, 6)}${i}`;
    if (!(await projectsRepo.isKeyTaken(db, candidate))) return candidate;
  }
  throw new ImportStoppedError("Could not pick a free project key for this import.");
}

const toDate = (value: string | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Project, board columns and sprints for the import; then moves the run to the issue phase. */
export async function runSetup(
  session: JiraSession,
  row: ImportRow,
  importerIsAccountAdmin: boolean,
): Promise<ImportRow> {
  const userId = session.userId;
  const boards = await fetchBoards(session, row.jiraProjectKey);
  let sprintBoards = boards.filter((b) => (b.type ?? "").toLowerCase() === "scrum");
  // Board type is not always reported: any board that has sprints counts as sprint-based.
  if (sprintBoards.length === 0 && boards.length > 0) {
    const probed: JiraBoard[] = [];
    for (const board of boards) {
      const page = await quietly(
        session.api<{ values?: { id: number }[] }>(
          `/rest/agile/1.0/board/${board.id}/sprint?maxResults=1`,
        ),
        { values: [] },
      );
      if ((page.values ?? []).length > 0) probed.push(board);
    }
    sprintBoards = probed;
  }
  const issueSprints = await fetchIssueSprints(session, row.jiraProjectKey);
  const projectType: ImportProjectType =
    sprintBoards.length > 0 || issueSprints.sprints.length > 0 ? "sprint" : "kanban";

  // Reuse the project already imported from this Jira project into this account.
  const existing = await imports.findImportedProject(db, row.accountId, row.jiraProjectId);
  if (existing?.archivedAt) throw new ImportStoppedError(ARCHIVED_IMPORT_MESSAGE);
  let projectId = existing?.id ?? null;
  if (!projectId) {
    const created = await projectsRepo.insertProject(db, {
      name: row.jiraProjectName,
      key: await uniqueProjectKey(row.jiraProjectKey),
      accountId: row.accountId,
      projectType,
      ownerId: userId,
      description: `Imported from Jira project ${row.jiraProjectKey}`,
      jiraCloudId: row.cloudId,
      jiraProjectId: row.jiraProjectId,
      jiraProjectKey: row.jiraProjectKey,
    });
    projectId = created.id;
  } else {
    // A refresh keeps the board style aligned with Jira.
    await projectsRepo.updateProject(db, projectId, { projectType });
  }
  // Account admins already reach every project of their account (and cannot hold a seat there).
  if (!importerIsAccountAdmin) await setupRepo.addMember(db, projectId, userId, "admin", "upgrade");

  // Columns mirror the Jira workflow statuses.
  const statuses = await fetchStatuses(session, row.jiraProjectKey, projectType);
  const columns = await setupRepo.listColumns(db, projectId);
  const have = new Set(columns.map((c) => c.name.toLowerCase()));
  let orderIndex = columns.reduce((max, c) => Math.max(max, c.orderIndex), -1) + 1;
  await setupRepo.insertColumns(
    db,
    statuses
      .filter((s) => !have.has(s.name.toLowerCase()))
      .map((s) => ({
        projectId: projectId!,
        name: s.name,
        orderIndex: orderIndex++,
        isDone: s.isDone,
      })),
  );

  const sprintMap: Record<string, string> = { ...issueSprints.sprintMap };
  if (projectType === "sprint") {
    let position = 0;
    const stored = new Set<string>();
    const storeSprint = async (s: JiraSprintValue) => {
      const jiraSprintId = String(s.id);
      if (stored.has(jiraSprintId)) return;
      stored.add(jiraSprintId);
      await setupRepo.upsertSprint(db, projectId!, jiraSprintId, position++, {
        name: (s.name ?? `Sprint ${s.id}`).slice(0, 50),
        goal: (s.goal ?? "").slice(0, 250) || null,
        startsAt: toDate(s.startDate),
        endsAt: toDate(s.endDate ?? s.completeDate),
        status: mapSprintStatus(s.state),
      });
    };
    for (const sprint of issueSprints.sprints) await storeSprint(sprint);
    for (const board of sprintBoards) {
      for (let startAt = 0; startAt < 500; startAt += 50) {
        const page = await quietly(
          session.api<{ values?: JiraSprintValue[]; isLast?: boolean }>(
            `/rest/agile/1.0/board/${board.id}/sprint?startAt=${startAt}&maxResults=50`,
          ),
          { values: [], isLast: true },
        );
        const sprints = page.values ?? [];
        for (const s of sprints) {
          await storeSprint(s);
          for (let issueStart = 0; issueStart < 1000; issueStart += 100) {
            const issuePage = await quietly(
              session.api<{ issues?: { key: string }[] }>(
                `/rest/agile/1.0/sprint/${s.id}/issue?fields=key&startAt=${issueStart}&maxResults=100`,
              ),
              { issues: [] },
            );
            const issues = issuePage.issues ?? [];
            for (const i of issues) sprintMap[i.key] = String(s.id);
            if (issues.length < 100) break;
          }
        }
        if (sprints.length < 50 || page.isLast) break;
      }
    }
  }

  const counted = await quietly(
    session.api<{ count?: number }>("/rest/api/3/search/approximate-count", {
      method: "POST",
      body: { jql: `project = "${row.jiraProjectKey}"` },
    }),
    { count: 0 },
  );
  const patch = {
    projectId,
    projectType,
    phase: "issues" as const,
    sprintMap,
    totalIssues: counted.count ?? 0,
    pageToken: null,
    error: null,
  };
  await imports.patchImport(db, row.id, patch);
  return { ...row, ...patch };
}
