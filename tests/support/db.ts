import { sql } from "drizzle-orm";
import { db } from "../../src/database/client.js";

/** Empties every application table between tests (migration bookkeeping lives in another schema). */
export async function resetDatabase(): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = result.rows.map((row) => `"public"."${row.tablename}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
  await db.execute(sql`insert into public.email_send_state (id) values (1) on conflict do nothing`);
}
