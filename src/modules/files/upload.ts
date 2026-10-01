import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { fileTypeFromBuffer } from "file-type";
import multer from "multer";
import { ValidationError } from "../../shared/http/errors.js";

export const MB = 1024 * 1024;

/** Raster images safe to render inline (SVG is excluded: it can carry script). */
export const INLINE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

/** Parses one multipart field named `file`, held in memory up to `maxBytes`. */
export function singleFile(maxBytes: number): RequestHandler {
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 10 },
  }).single("file");
  return (req, res, next) => {
    parser(req, res, (error: unknown) => {
      if (!error) return next();
      const code = (error as { code?: string }).code;
      if (code === "LIMIT_FILE_SIZE")
        return next(new ValidationError(`File is too large (max ${Math.round(maxBytes / MB)} MB)`));
      next(new ValidationError("Upload could not be read"));
    });
  };
}

export type UploadedFile = {
  buffer: Buffer;
  originalName: string;
  size: number;
  contentType: string;
};

/**
 * Validates the uploaded file and determines its real content type from its bytes (the browser's
 * claim is only used for formats without a signature, such as plain text).
 */
export async function readUpload(
  file: Express.Multer.File | undefined,
  allowed?: string[],
): Promise<UploadedFile> {
  if (!file || file.size === 0) throw new ValidationError("A file is required");
  const sniffed = await fileTypeFromBuffer(file.buffer);
  const contentType =
    sniffed?.mime ??
    (file.mimetype.startsWith("text/") ? "text/plain" : "application/octet-stream");
  if (allowed && !allowed.includes(contentType))
    throw new ValidationError("This file type is not allowed");
  return { buffer: file.buffer, originalName: file.originalname, size: file.size, contentType };
}

/** Collision-free object key `<scope>/<uuid>-<safe name>`; never trusts path segments from the client. */
export function objectKeyFor(scope: string, originalName: string): string {
  const base = originalName.split(/[\\/]/).pop() ?? "file";
  const safe =
    base
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-.]+/, "")
      .slice(-120) || "file";
  return `${scope}/${randomUUID()}-${safe}`;
}

/** First path segment of a storage key (owner user id, ticket id, project id ...). */
export function keyScope(key: string): string | null {
  const [scope, rest] = key.split("/", 2);
  return scope && rest ? scope : null;
}
