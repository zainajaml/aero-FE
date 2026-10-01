import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../database/client.js";
import { accounts, auditLogs, profiles, projects } from "../../database/schema/index.js";
import { requireAdminScope } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import { displayName } from "../users/names.js";

const SORTS = {
  createdAt: auditLogs.createdAt,
  action: auditLogs.action,
  table: auditLogs.tableName,
  field: auditLogs.field,
  value: auditLogs.value,
  user: profiles.fullName,
  project: projects.name,
  account: accounts.name,
} as const;
export type AuditSort = keyof typeof SORTS;

export type AuditQuery = {
  projectId?: string;
  userId?: string;
  q?: string;
  sort: AuditSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
};

/** Super admins see everything; account and project admins only rows of projects they administer. */
export async function listAuditLogs(actor: Actor, query: AuditQuery) {
  const scope = await requireAdminScope(actor);
  const conditions: SQL[] = [];
  if (!scope.isGlobalAdmin) {
    if (scope.projectIds.length === 0)
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    conditions.push(inArray(auditLogs.projectId, scope.projectIds));
  }
  if (query.projectId) conditions.push(eq(auditLogs.projectId, query.projectId));
  if (query.userId) conditions.push(eq(auditLogs.userId, query.userId));
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        sql`${auditLogs.action} ilike ${like}`,
        sql`${auditLogs.tableName} ilike ${like}`,
        sql`${auditLogs.field} ilike ${like}`,
        sql`${auditLogs.value} ilike ${like}`,
        sql`${profiles.fullName} ilike ${like}`,
        sql`${projects.name} ilike ${like}`,
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const base = () =>
    db
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        action: auditLogs.action,
        tableName: auditLogs.tableName,
        field: auditLogs.field,
        value: auditLogs.value,
        link: auditLogs.link,
        userId: auditLogs.userId,
        projectId: auditLogs.projectId,
        projectName: projects.name,
        accountId: projects.accountId,
        accountName: accounts.name,
        fullName: profiles.fullName,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
      })
      .from(auditLogs)
      .leftJoin(profiles, eq(profiles.id, auditLogs.userId))
      .leftJoin(projects, eq(projects.id, auditLogs.projectId))
      .leftJoin(accounts, eq(accounts.id, projects.accountId));
  const order = query.dir === "asc" ? asc(SORTS[query.sort]) : desc(SORTS[query.sort]);
  const [rows, [total]] = await Promise.all([
    base()
      .where(where)
      .orderBy(order, desc(auditLogs.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ n: count() })
      .from(auditLogs)
      .leftJoin(profiles, eq(profiles.id, auditLogs.userId))
      .leftJoin(projects, eq(projects.id, auditLogs.projectId))
      .where(where),
  ]);
  return {
    items: rows.map(({ fullName, firstName, lastName, email, ...row }) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      userName: displayName({ fullName, firstName, lastName, email }, "System"),
    })),
    total: total?.n ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}
