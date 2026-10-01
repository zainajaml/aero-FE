import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import * as service from "./files.service.js";
import { MB, singleFile } from "./upload.js";

const areaSchema = z
  .enum(["avatars", "attachments", "document-images", "documents", "support"])
  .meta({ id: "StorageArea" });

export const fileRoutes = [
  defineRoute({
    method: "post",
    path: "/files/signed-urls",
    operationId: "signFileUrls",
    summary: "Short-lived download URLs for stored files the caller may read (others are omitted)",
    tags: ["files"],
    request: {
      body: z
        .object({ area: areaSchema, keys: z.array(z.string().min(3).max(500)).min(1).max(200) })
        .meta({ id: "SignFileUrlsRequest" }),
    },
    response: {
      status: 200,
      schema: z.object({ urls: z.record(z.string(), z.string()) }).meta({ id: "SignedFileUrls" }),
    },
    handler: async ({ actor, body }) => ({
      urls: await service.signUrls(actor, body.area, body.keys),
    }),
  }),
  defineRoute({
    method: "post",
    path: "/files/document-images",
    operationId: "uploadDocumentImage",
    summary:
      "Upload an inline image for rich text (multipart field `file`, PNG/JPEG/GIF/WebP, max 10 MB)",
    tags: ["files"],
    middleware: [singleFile(10 * MB)],
    upload: { description: "Image file (PNG, JPEG, GIF or WebP), max 10 MB" },
    response: {
      status: 201,
      schema: z.object({ key: z.string(), url: z.string() }).meta({ id: "UploadedImage" }),
    },
    errors: [403],
    handler: ({ actor, req }) => service.uploadDocumentImage(actor, req.file),
  }),
];
