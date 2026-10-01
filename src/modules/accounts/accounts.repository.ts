import { eq, like, or } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { accounts } from "../../database/schema/index.js";

export type AccountRow = typeof accounts.$inferSelect;

export async function findAccount(db: DbExecutor, id: string): Promise<AccountRow | null> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return row ?? null;
}

export async function insertAccount(
  db: DbExecutor,
  row: typeof accounts.$inferInsert,
): Promise<AccountRow> {
  const [inserted] = await db.insert(accounts).values(row).returning();
  return inserted!;
}

export async function renameAccount(db: DbExecutor, id: string, name: string): Promise<void> {
  await db.update(accounts).set({ name }).where(eq(accounts.id, id));
}

export async function slugsLike(db: DbExecutor, base: string): Promise<Set<string>> {
  const rows = await db
    .select({ slug: accounts.slug })
    .from(accounts)
    .where(or(eq(accounts.slug, base), like(accounts.slug, `${base}-%`)));
  return new Set(rows.map((row) => row.slug));
}
