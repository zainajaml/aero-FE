import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { emailSendLog, emailSendState, suppressedEmails } from "../../database/schema/index.js";

export async function isSuppressed(db: DbExecutor, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: suppressedEmails.id })
    .from(suppressedEmails)
    .where(sql`lower(${suppressedEmails.email}) = lower(${email})`)
    .limit(1);
  return rows.length > 0;
}

export async function providerBackoffUntil(db: DbExecutor): Promise<Date | null> {
  const [row] = await db
    .select({ until: emailSendState.retryAfterUntil })
    .from(emailSendState)
    .where(eq(emailSendState.id, 1));
  return row?.until ?? null;
}

export async function setProviderBackoff(db: DbExecutor, until: Date): Promise<void> {
  await db.update(emailSendState).set({ retryAfterUntil: until }).where(eq(emailSendState.id, 1));
}

export type NewEmailLog = typeof emailSendLog.$inferInsert;

export async function insertEmailLog(db: DbExecutor, row: NewEmailLog): Promise<string> {
  const [inserted] = await db.insert(emailSendLog).values(row).returning({ id: emailSendLog.id });
  return inserted!.id;
}

export async function updateEmailLog(
  db: DbExecutor,
  id: string,
  patch: Partial<Pick<NewEmailLog, "status" | "messageId" | "errorMessage">>,
): Promise<void> {
  await db.update(emailSendLog).set(patch).where(eq(emailSendLog.id, id));
}

export async function providerSendDelayMs(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({ delay: emailSendState.sendDelayMs })
    .from(emailSendState)
    .where(eq(emailSendState.id, 1));
  return row?.delay ?? 0;
}
