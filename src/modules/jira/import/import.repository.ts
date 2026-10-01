import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../../database/client.js";
import {
  accountAdmins,
  accounts,
  jiraImports,
  profiles,
  projectMembers,
  projects,
  tickets,
} from "../../../database/schema/index.js";
import { toImportRow, type ImportRow } from "./import.types.js";

/** Import rows are always read through their owner: another user's id is a 404. */
export async function findImport(
  db: DbExecutor,
  userId: string,
  importId: string,
): Promise<ImportRow | null> {
  const [row] = await db
    .select()
    .from(jiraImports)
    .where(and(eq(jiraImports.id, importId), eq(jiraImports.userId, userId)))
    .limit(1);
  return row ? toImportRow(row) : null;
}

/** Latest unfinished run of the same Jira project by the same user into the same account. */
export async function findResumable(
  db: DbExecutor,
  input: { userId: string; accountId: string; cloudId: string; jiraProjectId: string },
): Promise<ImportRow | null> {
  const [row] = await db
    .select()
    .from(jiraImports)
    .where(
      and(
        eq(jiraImports.userId, input.userId),
        eq(jiraImports.accountId, input.accountId),
        eq(jiraImports.cloudId, input.cloudId),
        eq(jiraImports.jiraProjectId, input.jiraProjectId),
        inArray(jiraImports.phase, ["setup", "issues", "error"]),
      ),
    )
    .orderBy(desc(jiraImports.createdAt))
    .limit(1);
  return row ? toImportRow(row) : null;
}

export async function insertImport(
  db: DbExecutor,
  values: typeof jiraImports.$inferInsert,
): Promise<ImportRow> {
  const [row] = await db.insert(jiraImports).values(values).returning();
  return toImportRow(row!);
}

export type ImportPatch = Partial<
  Pick<
    ImportRow,
    | "projectId"
    | "projectType"
    | "phase"
    | "pageToken"
    | "processedIssues"
    | "totalIssues"
    | "importedComments"
    | "importedWorklogs"
    | "importedAttachments"
    | "sprintMap"
    | "jiraUsers"
    | "warnings"
    | "error"
  >
>;

export async function patchImport(db: DbExecutor, id: string, patch: ImportPatch): Promise<void> {
  await db
    .update(jiraImports)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(jiraImports.id, id));
}

export async function accountExists(db: DbExecutor, accountId: string): Promise<boolean> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  return rows.length > 0;
}

const projectBrief = {
  id: projects.id,
  name: projects.name,
  key: projects.key,
  archivedAt: projects.archivedAt,
};

export async function findProjectBrief(db: DbExecutor, projectId: string) {
  const [row] = await db.select(projectBrief).from(projects).where(eq(projects.id, projectId));
  return row ?? null;
}

/** The project already imported from this Jira project into this account (any site). */
export async function findImportedProject(
  db: DbExecutor,
  accountId: string,
  jiraProjectId: string,
  cloudId?: string,
) {
  const [row] = await db
    .select(projectBrief)
    .from(projects)
    .where(
      and(
        eq(projects.accountId, accountId),
        eq(projects.jiraProjectId, jiraProjectId),
        ...(cloudId ? [eq(projects.jiraCloudId, cloudId)] : []),
      ),
    )
    .orderBy(projects.createdAt)
    .limit(1);
  return row ?? null;
}

export async function countTickets(db: DbExecutor, projectId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(tickets)
    .where(eq(tickets.projectId, projectId));
  return Number(row?.n ?? 0);
}

/** Active people of an account: the importer, its account admins and its projects' members. */
export async function accountPeople(db: DbExecutor, accountId: string, importerId: string) {
  const members = await db
    .selectDistinct({ userId: projectMembers.userId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projects.accountId, accountId));
  const admins = await db
    .select({ userId: accountAdmins.userId })
    .from(accountAdmins)
    .where(eq(accountAdmins.accountId, accountId));
  const ids = [
    ...new Set([importerId, ...members.map((m) => m.userId), ...admins.map((a) => a.userId)]),
  ];
  return db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      email: profiles.email,
      archivedAt: profiles.archivedAt,
    })
    .from(profiles)
    .where(inArray(profiles.id, ids));
}
