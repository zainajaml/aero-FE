import { and, asc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { profilePrivate, timeOff } from "../../database/schema/index.js";

export async function findPrivate(db: DbExecutor, userId: string) {
  const [row] = await db
    .select()
    .from(profilePrivate)
    .where(eq(profilePrivate.id, userId))
    .limit(1);
  return row ?? null;
}

export async function upsertPrivate(
  db: DbExecutor,
  userId: string,
  patch: Partial<typeof profilePrivate.$inferInsert>,
) {
  const [row] = await db
    .insert(profilePrivate)
    .values({ id: userId, ...patch })
    .onConflictDoUpdate({ target: profilePrivate.id, set: patch })
    .returning();
  return row!;
}

export async function listTimeOff(db: DbExecutor, userId: string) {
  return db
    .select()
    .from(timeOff)
    .where(eq(timeOff.userId, userId))
    .orderBy(asc(timeOff.startDate));
}

export async function insertTimeOff(db: DbExecutor, row: typeof timeOff.$inferInsert) {
  const [inserted] = await db.insert(timeOff).values(row).returning();
  return inserted!;
}

export async function deleteOwnTimeOff(
  db: DbExecutor,
  userId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(timeOff)
    .where(and(eq(timeOff.id, id), eq(timeOff.userId, userId)))
    .returning({ id: timeOff.id });
  return rows.length > 0;
}
