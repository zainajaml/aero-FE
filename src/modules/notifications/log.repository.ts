import { and, count, desc, eq, gt, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { emailSendLog } from "../../database/schema/index.js";

export type LogRow = typeof emailSendLog.$inferSelect;

/** Who may see which rows (built by the service from the actor's scope). */
export type LogVisibility =
  { all: true } | { email: string; projectIds: string[]; actorId: string; hideOwnActions: boolean };

const FAILED = ["failed", "bounced", "complained"];

/** Rows about any of `projectIds`: single-project emails log `project_id`, invitations log `project_ids`. */
function aboutProjects(projectIds: string[]): SQL {
  const ids = sql`array[${sql.join(
    projectIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  return sql`(${emailSendLog.metadata}->>'project_id' = any(${ids}) or jsonb_exists_any(coalesce(${emailSendLog.metadata}->'project_ids', '[]'::jsonb), ${ids}))`;
}

function visibilityCondition(v: LogVisibility): SQL | undefined {
  if ("all" in v) return undefined;
  const own = sql`lower(${emailSendLog.recipientEmail}) = lower(${v.email})`;
  const ownNotSelf = v.hideOwnActions
    ? and(own, sql`coalesce(${emailSendLog.metadata}->>'actor_id', '') <> ${v.actorId}`)!
    : own;
  const scoped: SQL[] = [ownNotSelf];
  if (v.projectIds.length > 0) {
    scoped.push(aboutProjects(v.projectIds));
    scoped.push(
      and(
        eq(emailSendLog.templateName, "invite"),
        sql`${emailSendLog.metadata}->>'actor_id' = ${v.actorId}`,
      )!,
    );
  }
  return or(...scoped);
}

export type LogQuery = {
  visibility: LogVisibility;
  projectId?: string;
  failedOnly?: boolean;
  search?: string;
  since?: Date;
  limit: number;
  offset: number;
};

function where(q: LogQuery): SQL | undefined {
  const conditions: (SQL | undefined)[] = [visibilityCondition(q.visibility)];
  if (q.projectId) conditions.push(aboutProjects([q.projectId]));
  if (q.failedOnly) conditions.push(inArray(emailSendLog.status, FAILED));
  if (q.since) conditions.push(gt(emailSendLog.createdAt, q.since));
  if (q.search) {
    const like = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        sql`${emailSendLog.recipientEmail} ilike ${like}`,
        sql`${emailSendLog.subject} ilike ${like}`,
        sql`${emailSendLog.metadata}->>'ticket_code' ilike ${like}`,
        sql`${emailSendLog.metadata}->>'actor_name' ilike ${like}`,
      ),
    );
  }
  const present = conditions.filter((c): c is SQL => Boolean(c));
  return present.length ? and(...present) : undefined;
}

export async function listLog(db: DbExecutor, q: LogQuery) {
  const condition = where(q);
  const [rows, [total], [failed]] = await Promise.all([
    db
      .select({
        id: emailSendLog.id,
        templateName: emailSendLog.templateName,
        recipientEmail: emailSendLog.recipientEmail,
        status: emailSendLog.status,
        subject: emailSendLog.subject,
        errorMessage: emailSendLog.errorMessage,
        metadata: emailSendLog.metadata,
        createdAt: emailSendLog.createdAt,
      })
      .from(emailSendLog)
      .where(condition)
      .orderBy(desc(emailSendLog.createdAt))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ n: count() }).from(emailSendLog).where(condition),
    db
      .select({ n: count() })
      .from(emailSendLog)
      .where(and(where({ ...q, failedOnly: true }))),
  ]);
  return { rows, total: total?.n ?? 0, failed: failed?.n ?? 0 };
}

export async function countLog(db: DbExecutor, q: Omit<LogQuery, "limit" | "offset">) {
  const [row] = await db
    .select({ n: count() })
    .from(emailSendLog)
    .where(where({ ...q, limit: 0, offset: 0 }));
  return row?.n ?? 0;
}

export async function findLogRow(
  db: DbExecutor,
  id: string,
  visibility: LogVisibility,
): Promise<LogRow | null> {
  const [row] = await db
    .select()
    .from(emailSendLog)
    .where(and(eq(emailSendLog.id, id), visibilityCondition(visibility)))
    .limit(1);
  return row ?? null;
}
