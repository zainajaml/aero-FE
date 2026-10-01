import { eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { attachments, documents, tickets } from "../../database/schema/index.js";

export async function projectOfAttachmentKey(db: DbExecutor, key: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: tickets.projectId })
    .from(attachments)
    .innerJoin(tickets, eq(tickets.id, attachments.ticketId))
    .where(eq(attachments.storagePath, key))
    .limit(1);
  return row?.projectId ?? null;
}

/** Projects whose documents reference this stored file. */
export async function projectsReferencingDocumentFile(
  db: DbExecutor,
  key: string,
): Promise<string[]> {
  const rows = await db
    .select({ projectId: documents.projectId })
    .from(documents)
    .where(eq(documents.filePath, key));
  return rows.map((row) => row.projectId);
}
