import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../../../database/client.js";
import { boardColumns, projectMembers, sprints } from "../../../database/schema/index.js";
import type { AppRole } from "../../../database/schema/_shared.js";

/**
 * Adds a project member unless the user administers the project's account (account admins hold
 * no project seats there; the database would reject it). `upgrade` overwrites an existing role,
 * otherwise an existing membership is never changed.
 */
export async function addMember(
  db: DbExecutor,
  projectId: string,
  userId: string,
  role: AppRole,
  mode: "upgrade" | "keep" = "keep",
): Promise<void> {
  await db.execute(sql`
    insert into ${projectMembers} (project_id, user_id, role)
    select ${projectId}::uuid, ${userId}::uuid, ${role}::app_role
    where not exists (
      select 1 from public.projects p
      join public.account_admins aa on aa.account_id = p.account_id
      where p.id = ${projectId}::uuid and aa.user_id = ${userId}::uuid
    )
    on conflict (project_id, user_id) do ${
      mode === "upgrade" ? sql`update set role = excluded.role` : sql`nothing`
    }`);
}

export async function listColumns(db: DbExecutor, projectId: string) {
  return db
    .select({ id: boardColumns.id, name: boardColumns.name, orderIndex: boardColumns.orderIndex })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(asc(boardColumns.orderIndex));
}

export async function insertColumns(
  db: DbExecutor,
  rows: { projectId: string; name: string; orderIndex: number; isDone: boolean }[],
): Promise<void> {
  if (rows.length > 0) await db.insert(boardColumns).values(rows);
}

export type SprintFields = {
  name: string;
  goal: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: "planned" | "active" | "completed";
};

/** Creates or refreshes the sprint carrying this Jira sprint id (position only on insert). */
export async function upsertSprint(
  db: DbExecutor,
  projectId: string,
  jiraSprintId: string,
  position: number,
  fields: SprintFields,
): Promise<void> {
  await db
    .insert(sprints)
    .values({ projectId, jiraSprintId, position, ...fields })
    .onConflictDoUpdate({
      target: [sprints.projectId, sprints.jiraSprintId],
      targetWhere: isNotNull(sprints.jiraSprintId),
      set: fields,
    });
}

export async function listJiraSprints(db: DbExecutor, projectId: string) {
  return db
    .select({ id: sprints.id, jiraSprintId: sprints.jiraSprintId })
    .from(sprints)
    .where(and(eq(sprints.projectId, projectId), isNotNull(sprints.jiraSprintId)));
}
