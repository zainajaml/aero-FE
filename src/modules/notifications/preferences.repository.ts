import { eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { notificationPreferences } from "../../database/schema/index.js";

export async function findPreferences(db: DbExecutor, userId: string) {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function preferencesFor(db: DbExecutor, userIds: string[]) {
  if (userIds.length === 0) return [];
  return db
    .select()
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, userIds));
}

export async function upsertPreferences(
  db: DbExecutor,
  userId: string,
  values: { prefs: Record<string, boolean>; ticketAssignmentEmail?: boolean },
) {
  await db
    .insert(notificationPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: values });
}
