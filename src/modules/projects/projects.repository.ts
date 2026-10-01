import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import {
  boardColumns,
  profiles,
  projectMembers,
  projects,
  rateCard,
  sprints,
  tickets,
} from "../../database/schema/index.js";
import { defaultColumns, type ProjectType } from "./project-defaults.js";

export type ProjectRow = typeof projects.$inferSelect;

export async function findProject(db: DbExecutor, id: string): Promise<ProjectRow | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ?? null;
}

export async function isKeyTaken(
  db: DbExecutor,
  key: string,
  exceptProjectId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      exceptProjectId
        ? and(eq(projects.key, key), ne(projects.id, exceptProjectId))
        : eq(projects.key, key),
    )
    .limit(1);
  return rows.length > 0;
}

export async function insertProject(
  db: DbExecutor,
  row: typeof projects.$inferInsert,
): Promise<ProjectRow> {
  const [inserted] = await db.insert(projects).values(row).returning();
  return inserted!;
}

export async function updateProject(
  db: DbExecutor,
  id: string,
  patch: Partial<typeof projects.$inferInsert>,
) {
  const [updated] = await db.update(projects).set(patch).where(eq(projects.id, id)).returning();
  return updated ?? null;
}

export async function firstProjectOfAccount(
  db: DbExecutor,
  accountId: string,
): Promise<ProjectRow | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(eq(projects.accountId, accountId))
    .orderBy(asc(projects.createdAt))
    .limit(1);
  return row ?? null;
}

export async function replaceWithDefaultColumns(
  db: DbExecutor,
  projectId: string,
  type: ProjectType,
): Promise<void> {
  await db.delete(boardColumns).where(eq(boardColumns.projectId, projectId));
  await insertDefaultColumns(db, projectId, type);
}

export async function insertDefaultColumns(
  db: DbExecutor,
  projectId: string,
  type: ProjectType,
): Promise<void> {
  await db.insert(boardColumns).values(
    defaultColumns(type).map((column, index) => ({
      projectId,
      name: column.name,
      orderIndex: index,
      isDone: column.isDone,
    })),
  );
}

export async function listProjects(
  db: DbExecutor,
  filter: { all: true } | { ids: string[] },
): Promise<ProjectRow[]> {
  const base = db.select().from(projects);
  if ("all" in filter) return base.orderBy(desc(projects.createdAt));
  if (filter.ids.length === 0) return [];
  return base.where(inArray(projects.id, filter.ids)).orderBy(desc(projects.createdAt));
}

export async function deleteProject(db: DbExecutor, id: string): Promise<void> {
  await db.delete(projects).where(eq(projects.id, id));
}

export async function addProjectAdmin(
  db: DbExecutor,
  projectId: string,
  userId: string,
): Promise<void> {
  await db
    .insert(projectMembers)
    .values({ projectId, userId, role: "admin" })
    .onConflictDoNothing();
}

/** Copies the rate card of the sibling project (same account) that has the most rate rows. */
export async function inheritRateCard(
  db: DbExecutor,
  projectId: string,
  accountId: string,
): Promise<void> {
  const [source] = await db
    .select({ projectId: rateCard.projectId, count: sql<number>`count(*)::int` })
    .from(rateCard)
    .innerJoin(projects, eq(projects.id, rateCard.projectId))
    .where(and(eq(projects.accountId, accountId), ne(projects.id, projectId)))
    .groupBy(rateCard.projectId)
    .orderBy(desc(sql`count(*)`))
    .limit(1);
  if (!source) return;
  const rows = await db.select().from(rateCard).where(eq(rateCard.projectId, source.projectId));
  await db
    .insert(rateCard)
    .values(
      rows.map((row) => ({
        projectId,
        role: row.role,
        location: row.location,
        hourlyRate: row.hourlyRate,
      })),
    );
}

export type ProjectStats = {
  projectId: string;
  tickets: number;
  sprints: number;
  members: number;
  activeSprint: boolean;
  lastSprintEndsAt: Date | null;
};

export async function projectStats(db: DbExecutor, ids: string[]): Promise<ProjectStats[]> {
  if (ids.length === 0) return [];
  const result = await db.execute<{
    project_id: string;
    tickets: number;
    sprints: number;
    members: number;
    active_sprint: boolean;
    last_sprint_ends_at: Date | null;
  }>(sql`
    select p.id as project_id,
      (select count(*)::int from ${tickets} t where t.project_id = p.id) as tickets,
      (select count(*)::int from ${sprints} s where s.project_id = p.id) as sprints,
      (select count(*)::int from ${projectMembers} pm join ${profiles} pr on pr.id = pm.user_id
        where pm.project_id = p.id and pr.archived_at is null) as members,
      exists (select 1 from ${sprints} s where s.project_id = p.id and s.status = 'active') as active_sprint,
      (select max(s.ends_at) from ${sprints} s where s.project_id = p.id) as last_sprint_ends_at
    from ${projects} p
    where p.id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return result.rows.map((row) => ({
    projectId: row.project_id,
    tickets: row.tickets,
    sprints: row.sprints,
    members: row.members,
    activeSprint: row.active_sprint,
    lastSprintEndsAt: row.last_sprint_ends_at ? new Date(row.last_sprint_ends_at) : null,
  }));
}

export type RateCardRow = typeof rateCard.$inferSelect;

export async function listRateCard(db: DbExecutor, projectIds: string[]): Promise<RateCardRow[]> {
  if (projectIds.length === 0) return [];
  return db
    .select()
    .from(rateCard)
    .where(inArray(rateCard.projectId, projectIds))
    .orderBy(asc(rateCard.role));
}

export async function findRate(db: DbExecutor, id: string): Promise<RateCardRow | null> {
  const [row] = await db.select().from(rateCard).where(eq(rateCard.id, id)).limit(1);
  return row ?? null;
}

export async function insertRate(
  db: DbExecutor,
  row: typeof rateCard.$inferInsert,
): Promise<RateCardRow> {
  const [inserted] = await db.insert(rateCard).values(row).returning();
  return inserted!;
}

export async function updateRate(
  db: DbExecutor,
  id: string,
  patch: Partial<typeof rateCard.$inferInsert>,
): Promise<RateCardRow> {
  const [updated] = await db.update(rateCard).set(patch).where(eq(rateCard.id, id)).returning();
  return updated!;
}

export async function deleteRate(db: DbExecutor, id: string): Promise<void> {
  await db.delete(rateCard).where(eq(rateCard.id, id));
}
