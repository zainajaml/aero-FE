import { eq, lt } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { jiraConnections, jiraOauthStates } from "../../database/schema/index.js";

/** Stored row: token columns hold AES-256-GCM envelopes, never plaintext. */
export type ConnectionRow = typeof jiraConnections.$inferSelect;

export async function findConnection(
  db: DbExecutor,
  userId: string,
): Promise<ConnectionRow | null> {
  const [row] = await db
    .select()
    .from(jiraConnections)
    .where(eq(jiraConnections.userId, userId))
    .limit(1);
  return row ?? null;
}

/** Locks the user's row until the surrounding transaction ends (serializes token refresh). */
export async function lockConnection(
  db: DbExecutor,
  userId: string,
): Promise<ConnectionRow | null> {
  const [row] = await db
    .select()
    .from(jiraConnections)
    .where(eq(jiraConnections.userId, userId))
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function upsertConnection(
  db: DbExecutor,
  row: Omit<typeof jiraConnections.$inferInsert, "createdAt" | "updatedAt">,
): Promise<void> {
  const { userId, ...update } = row;
  await db
    .insert(jiraConnections)
    .values({ userId, ...update })
    .onConflictDoUpdate({
      target: jiraConnections.userId,
      set: { ...update, updatedAt: new Date() },
    });
}

export async function updateConnection(
  db: DbExecutor,
  userId: string,
  patch: Partial<
    Pick<
      ConnectionRow,
      "cloudId" | "siteName" | "siteUrl" | "accessToken" | "refreshToken" | "expiresAt" | "scope"
    >
  >,
): Promise<void> {
  await db
    .update(jiraConnections)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(jiraConnections.userId, userId));
}

export async function deleteConnection(db: DbExecutor, userId: string): Promise<boolean> {
  const rows = await db
    .delete(jiraConnections)
    .where(eq(jiraConnections.userId, userId))
    .returning({ userId: jiraConnections.userId });
  return rows.length > 0;
}

export async function insertOauthState(
  db: DbExecutor,
  state: string,
  userId: string,
): Promise<void> {
  await db.insert(jiraOauthStates).values({ state, userId });
}

export async function deleteOauthStatesBefore(db: DbExecutor, cutoff: Date): Promise<void> {
  await db.delete(jiraOauthStates).where(lt(jiraOauthStates.createdAt, cutoff));
}

/** Atomically consumes a state (single use): the row is gone whether or not it is still fresh. */
export async function consumeOauthState(
  db: DbExecutor,
  state: string,
): Promise<{ userId: string; createdAt: Date } | null> {
  const [row] = await db
    .delete(jiraOauthStates)
    .where(eq(jiraOauthStates.state, state))
    .returning({ userId: jiraOauthStates.userId, createdAt: jiraOauthStates.createdAt });
  return row ?? null;
}
