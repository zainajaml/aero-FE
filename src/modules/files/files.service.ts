import { db } from "../../database/client.js";
import {
  putObject,
  signedDownloadUrl,
  type StorageArea,
} from "../../integrations/storage/object-storage.js";
import { ForbiddenError } from "../../shared/http/errors.js";
import * as policy from "../access/access.policy.js";
import { requireProjectMember } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import { listVisibleProjectAccounts } from "../access/access.repository.js";
import { sharesProject } from "../users/people.repository.js";
import * as repo from "./files.repository.js";
import { INLINE_IMAGE_TYPES, keyScope, objectKeyFor, readUpload } from "./upload.js";

async function isMemberOf(actor: Actor, projectId: string): Promise<boolean> {
  try {
    await requireProjectMember(actor, projectId);
    return true;
  } catch {
    return false;
  }
}

/** Read rules per storage area (ported from the storage.objects SELECT policies). */
async function canRead(actor: Actor, area: StorageArea, key: string): Promise<boolean> {
  const scope = keyScope(key);
  if (!scope) return false;
  if (policy.isSuperAdmin(actor)) return true;
  switch (area) {
    case "avatars":
      return scope === actor.userId || (await sharesProject(db, actor.userId, scope));
    case "support":
      return scope === actor.userId;
    case "attachments": {
      const projectId = await repo.projectOfAttachmentKey(db, key);
      return projectId !== null && (await isMemberOf(actor, projectId));
    }
    case "documents":
      return isMemberOf(actor, scope);
    case "document-images": {
      if (scope === actor.userId || (await sharesProject(db, actor.userId, scope))) return true;
      for (const projectId of await repo.projectsReferencingDocumentFile(db, key)) {
        if (await isMemberOf(actor, projectId)) return true;
      }
      return false;
    }
  }
}

/** Signed URLs for the keys the actor may read; others are simply absent from the result. */
export async function signUrls(
  actor: Actor,
  area: StorageArea,
  keys: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(keys)];
  const allowed = await Promise.all(
    unique.map(async (key) => ((await canRead(actor, area, key)) ? key : null)),
  );
  const entries = await Promise.all(
    allowed
      .filter((key): key is string => key !== null)
      .map(async (key) => [key, await signedDownloadUrl(area, key)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Inline images for rich text (documents, descriptions, comments). Ports the upload policy:
 * the uploader's own folder, no global viewer role, and membership somewhere (or super admin).
 */
export async function uploadDocumentImage(actor: Actor, file: Express.Multer.File | undefined) {
  if (actor.globalRoles.includes("viewer") && !policy.isSuperAdmin(actor)) {
    throw new ForbiddenError("You have view-only access — changes are not allowed.", "VIEW_ONLY");
  }
  if (
    !policy.isSuperAdmin(actor) &&
    (await listVisibleProjectAccounts(db, actor, false)).length === 0
  ) {
    throw new ForbiddenError("Join a project before uploading images");
  }
  const upload = await readUpload(file, INLINE_IMAGE_TYPES);
  const key = objectKeyFor(actor.userId, upload.originalName);
  await putObject("document-images", key, upload.buffer, upload.contentType);
  return { key, url: await signedDownloadUrl("document-images", key) };
}
