import {
  type AnyPgColumn,
  bigint,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared.js";
import { documentFolders } from "./document-folders.js";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => documents.id, {
      onDelete: "cascade",
    }),
    folderId: uuid("folder_id").references(() => documentFolders.id, { onDelete: "set null" }),
    title: text("title").notNull().default("Untitled"),
    icon: text("icon"),
    content: jsonb("content"),
    position: numeric("position", { mode: "number" }).notNull().default(0),
    filePath: text("file_path"),
    fileMime: text("file_mime"),
    fileSize: bigint("file_size", { mode: "number" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_documents_project").on(t.projectId),
    index("idx_documents_parent").on(t.parentId),
    index("idx_documents_folder_id").on(t.folderId),
  ],
);
