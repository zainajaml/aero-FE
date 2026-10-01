import { and, asc, eq, ne } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { boardColumns, projects } from "../../database/schema/index.js";
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
  await db
    .insert(boardColumns)
    .values(
      defaultColumns(type).map((column, index) => ({
        projectId,
        name: column.name,
        orderIndex: index,
        isDone: column.isDone,
      })),
    );
}
