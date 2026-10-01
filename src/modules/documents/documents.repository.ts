import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { documentFolders, documents } from "../../database/schema/index.js";

export type DocumentRow = typeof documents.$inferSelect;
export type FolderRow = typeof documentFolders.$inferSelect;

const metadata = {
  id: documents.id,
  projectId: documents.projectId,
  parentId: documents.parentId,
  folderId: documents.folderId,
  title: documents.title,
  icon: documents.icon,
  position: documents.position,
  fileMime: documents.fileMime,
  fileSize: documents.fileSize,
  createdBy: documents.createdBy,
  updatedAt: documents.updatedAt,
};

export const listDocuments = (db: DbExecutor, projectIds: string[]) =>
  projectIds.length === 0
    ? Promise.resolve([])
    : db
        .select(metadata)
        .from(documents)
        .where(inArray(documents.projectId, projectIds))
        .orderBy(asc(documents.position), asc(documents.title));

export const listFolders = (db: DbExecutor, projectIds: string[]) =>
  projectIds.length === 0
    ? Promise.resolve([])
    : db
        .select()
        .from(documentFolders)
        .where(inArray(documentFolders.projectId, projectIds))
        .orderBy(asc(documentFolders.position), asc(documentFolders.name));

export const listTitles = (db: DbExecutor, projectIds: string[], limit: number) =>
  projectIds.length === 0
    ? Promise.resolve([])
    : db
        .select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(inArray(documents.projectId, projectIds))
        .orderBy(asc(documents.title))
        .limit(limit);

export async function findDocument(db: DbExecutor, id: string): Promise<DocumentRow | null> {
  const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return row ?? null;
}

export async function findFolder(db: DbExecutor, id: string): Promise<FolderRow | null> {
  const [row] = await db.select().from(documentFolders).where(eq(documentFolders.id, id)).limit(1);
  return row ?? null;
}

export async function insertDocument(
  db: DbExecutor,
  row: typeof documents.$inferInsert,
): Promise<DocumentRow> {
  const [inserted] = await db.insert(documents).values(row).returning();
  return inserted!;
}

export async function updateDocument(
  db: DbExecutor,
  id: string,
  patch: Partial<typeof documents.$inferInsert>,
): Promise<DocumentRow> {
  const [row] = await db.update(documents).set(patch).where(eq(documents.id, id)).returning();
  return row!;
}

/** The document and all its descendants (parent_id tree), for storage cleanup before the cascade. */
export async function subtreeFiles(db: DbExecutor, id: string): Promise<string[]> {
  const result = await db.execute<{ file_path: string | null }>(sql`
    with recursive tree as (
      select id, file_path from ${documents} where id = ${id}
      union all
      select d.id, d.file_path from ${documents} d join tree t on d.parent_id = t.id
    )
    select file_path from tree where file_path is not null`);
  return result.rows.map((row) => row.file_path!).filter(Boolean);
}

export async function deleteDocument(db: DbExecutor, id: string) {
  await db.delete(documents).where(eq(documents.id, id));
}

export async function insertFolder(
  db: DbExecutor,
  row: typeof documentFolders.$inferInsert,
): Promise<FolderRow> {
  const [inserted] = await db.insert(documentFolders).values(row).returning();
  return inserted!;
}

export async function updateFolder(
  db: DbExecutor,
  id: string,
  patch: Partial<typeof documentFolders.$inferInsert>,
): Promise<FolderRow> {
  const [row] = await db
    .update(documentFolders)
    .set(patch)
    .where(eq(documentFolders.id, id))
    .returning();
  return row!;
}

export async function deleteFolder(db: DbExecutor, id: string) {
  await db.delete(documentFolders).where(eq(documentFolders.id, id));
}

export async function folderInProject(db: DbExecutor, folderId: string, projectId: string) {
  const rows = await db
    .select({ id: documentFolders.id })
    .from(documentFolders)
    .where(and(eq(documentFolders.id, folderId), eq(documentFolders.projectId, projectId)))
    .limit(1);
  return rows.length > 0;
}
