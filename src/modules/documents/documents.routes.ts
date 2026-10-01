import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import { MB, singleFile } from "../files/upload.js";
import * as service from "./documents.service.js";

const tags = ["documents"];
const documentMeta = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    parentId: z.uuid().nullable(),
    folderId: z.uuid().nullable(),
    title: z.string(),
    icon: z.string().nullable(),
    position: z.number(),
    file: z.object({ mime: z.string(), size: z.number().int().nullable() }).nullable(),
    createdBy: z.uuid().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "DocumentMeta" });
const folderSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    position: z.number(),
    createdBy: z.uuid().nullable(),
  })
  .meta({ id: "DocumentFolder" });
const documentParams = z.object({ documentId: z.uuid() });
const folderParams = z.object({ folderId: z.uuid() });
const projectParams = z.object({ projectId: z.uuid() });

export const documentRoutes = [
  defineRoute({
    method: "get",
    path: "/documents",
    operationId: "getDocumentLibrary",
    summary: "Documents (metadata only) and folders of one or all visible projects",
    tags,
    request: { query: z.object({ projectId: z.uuid().optional() }) },
    response: {
      status: 200,
      schema: z
        .object({ documents: z.array(documentMeta), folders: z.array(folderSchema) })
        .meta({ id: "DocumentLibrary" }),
    },
    handler: ({ actor, query }) =>
      service.library(actor, query.projectId ? [query.projectId] : undefined),
  }),
  defineRoute({
    method: "get",
    path: "/documents/tags",
    operationId: "listDocumentTags",
    summary: "Document titles for #tag suggestions (max 200)",
    tags,
    request: { query: z.object({ projectId: z.uuid().optional() }) },
    response: {
      status: 200,
      schema: z.array(z.object({ id: z.uuid(), title: z.string() }).meta({ id: "DocumentTag" })),
    },
    handler: ({ actor, query }) => service.tags(actor, query.projectId),
  }),
  defineRoute({
    method: "get",
    path: "/documents/:documentId",
    operationId: "getDocument",
    summary: "A document with its content and the caller's permissions",
    tags,
    request: { params: documentParams },
    response: {
      status: 200,
      schema: documentMeta
        .extend({ content: z.unknown(), canEdit: z.boolean(), canDelete: z.boolean() })
        .meta({ id: "Document" }),
    },
    errors: [404],
    handler: ({ actor, params }) => service.getDocument(actor, params.documentId),
  }),
  defineRoute({
    method: "get",
    path: "/documents/:documentId/file",
    operationId: "downloadDocumentFile",
    summary: "Stream the file of a file-backed document",
    tags,
    request: {
      params: documentParams,
      query: z.object({ download: z.enum(["true", "false"]).optional() }),
    },
    response: { status: 200, eventStream: "Binary file content (Content-Type of the stored file)" },
    errors: [404],
    handler: ({ actor, params, query, res }) =>
      service.streamDocumentFile(actor, params.documentId, res, query.download === "true"),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/documents",
    operationId: "createDocument",
    summary: "Create an empty rich-text document",
    tags,
    request: {
      params: projectParams,
      body: z
        .object({
          folderId: z.uuid().nullish(),
          parentId: z.uuid().nullish(),
          title: z.string().trim().max(255).optional(),
        })
        .meta({ id: "CreateDocumentRequest" }),
    },
    response: { status: 201, schema: documentMeta },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.createDocument(actor, params.projectId, body),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/documents/files",
    operationId: "uploadDocumentFile",
    summary: "Upload a file as a document (multipart field `file`, max 50 MB)",
    tags,
    request: { params: projectParams, query: z.object({ folderId: z.uuid().optional() }) },
    middleware: [singleFile(50 * MB)],
    upload: { description: "Any file, max 50 MB" },
    response: { status: 201, schema: documentMeta },
    errors: [403, 404, 409],
    handler: ({ actor, params, query, req }) =>
      service.uploadDocumentFile(actor, params.projectId, req.file, query.folderId ?? null),
  }),
  defineRoute({
    method: "patch",
    path: "/documents/:documentId",
    operationId: "updateDocument",
    summary: "Save title, content or icon",
    tags,
    request: {
      params: documentParams,
      body: z
        .object({
          title: z.string().max(255).optional(),
          content: z.record(z.string(), z.unknown()).nullable().optional(),
          icon: z.string().max(40).nullish(),
        })
        .meta({ id: "UpdateDocumentRequest" }),
    },
    response: { status: 200, schema: documentMeta },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.updateDocument(actor, params.documentId, body),
  }),
  defineRoute({
    method: "post",
    path: "/documents/:documentId/move",
    operationId: "moveDocument",
    summary: "Move a document into a folder (null = ungrouped)",
    tags,
    request: {
      params: documentParams,
      body: z.object({ folderId: z.uuid().nullable() }).meta({ id: "MoveDocumentRequest" }),
    },
    response: { status: 200, schema: documentMeta },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) =>
      service.moveDocument(actor, params.documentId, body.folderId),
  }),
  defineRoute({
    method: "delete",
    path: "/documents/:documentId",
    operationId: "deleteDocument",
    summary: "Delete a document, its sub-pages and stored files",
    tags,
    request: { params: documentParams },
    response: { status: 204 },
    errors: [403, 404, 409],
    handler: ({ actor, params }) => service.deleteDocument(actor, params.documentId),
  }),
  defineRoute({
    method: "post",
    path: "/projects/:projectId/document-folders",
    operationId: "createDocumentFolder",
    summary: "Create a folder",
    tags,
    request: {
      params: projectParams,
      body: z.object({ name: z.string().max(120).optional() }).meta({ id: "CreateFolderRequest" }),
    },
    response: { status: 201, schema: folderSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.createFolder(actor, params.projectId, body.name),
  }),
  defineRoute({
    method: "patch",
    path: "/document-folders/:folderId",
    operationId: "updateDocumentFolder",
    summary: "Rename or reorder a folder",
    tags,
    request: {
      params: folderParams,
      body: z
        .object({ name: z.string().max(120).optional(), position: z.number().optional() })
        .meta({ id: "UpdateFolderRequest" }),
    },
    response: { status: 200, schema: folderSchema },
    errors: [403, 404, 409],
    handler: ({ actor, params, body }) => service.updateFolder(actor, params.folderId, body),
  }),
  defineRoute({
    method: "delete",
    path: "/document-folders/:folderId",
    operationId: "deleteDocumentFolder",
    summary: "Delete a folder (documents become ungrouped)",
    tags,
    request: { params: folderParams },
    response: { status: 204 },
    errors: [403, 404, 409],
    handler: ({ actor, params }) => service.deleteFolder(actor, params.folderId),
  }),
];
