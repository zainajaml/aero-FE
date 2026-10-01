import { db } from "../../database/client.js";
import { deleteObjects, putObject } from "../../integrations/storage/object-storage.js";
import { NotFoundError } from "../../shared/http/errors.js";
import type { Actor } from "../access/access.types.js";
import { INLINE_IMAGE_TYPES, objectKeyFor, readUpload } from "../files/upload.js";
import { findProfile, updateProfile } from "./profiles.repository.js";
import * as repo from "./profile.repository.js";

export async function getMe(actor: Actor) {
  const profile = await findProfile(db, actor.userId);
  if (!profile) throw new NotFoundError("Profile");
  return {
    id: actor.userId,
    email: actor.email,
    emailVerified: actor.emailVerified,
    fullName: profile.fullName,
    firstName: profile.firstName,
    lastName: profile.lastName,
    avatarUrl: profile.avatarUrl,
    jobTitle: profile.jobTitle,
    timezone: profile.timezone,
  };
}

/**
 * Self-service profile edits. Only names and timezone are editable here: email, job title and the
 * archive state are managed by admins (the source let users update any of their profile columns).
 */
export async function updateMyProfile(
  actor: Actor,
  input: { firstName?: string | null; lastName?: string | null; timezone?: string },
) {
  const patch: Parameters<typeof updateProfile>[2] = {};
  if (input.firstName !== undefined || input.lastName !== undefined) {
    const current = await findProfile(db, actor.userId);
    const firstName =
      input.firstName !== undefined
        ? input.firstName?.trim() || null
        : (current?.firstName ?? null);
    const lastName =
      input.lastName !== undefined ? input.lastName?.trim() || null : (current?.lastName ?? null);
    Object.assign(patch, {
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" ") || null,
    });
  }
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (Object.keys(patch).length > 0) await updateProfile(db, actor.userId, patch);
  return getMe(actor);
}

export async function replaceAvatar(actor: Actor, file: Express.Multer.File | undefined) {
  const upload = await readUpload(file, INLINE_IMAGE_TYPES);
  const key = objectKeyFor(actor.userId, upload.originalName);
  await putObject("avatars", key, upload.buffer, upload.contentType);
  const previous = (await findProfile(db, actor.userId))?.avatarUrl;
  await updateProfile(db, actor.userId, { avatarUrl: key });
  if (previous && previous.startsWith(`${actor.userId}/`))
    await deleteObjects("avatars", [previous]).catch(() => undefined);
  return getMe(actor);
}

const toPrivateDto = (row: Awaited<ReturnType<typeof repo.findPrivate>>) => ({
  mobile: row?.mobile ?? null,
  employeeNumber: row?.employeeNumber ?? null,
  employmentStatus: row?.employmentStatus ?? null,
});

export async function getMyPrivate(actor: Actor) {
  return toPrivateDto(await repo.findPrivate(db, actor.userId));
}

export async function updateMyPrivate(
  actor: Actor,
  input: {
    mobile?: string | null;
    employeeNumber?: string | null;
    employmentStatus?: string | null;
  },
) {
  const patch = {
    ...(input.mobile !== undefined ? { mobile: input.mobile?.trim() || null } : {}),
    ...(input.employeeNumber !== undefined
      ? { employeeNumber: input.employeeNumber?.trim() || null }
      : {}),
    ...(input.employmentStatus !== undefined
      ? { employmentStatus: input.employmentStatus || null }
      : {}),
  };
  return toPrivateDto(await repo.upsertPrivate(db, actor.userId, patch));
}

const toTimeOffDto = (row: Awaited<ReturnType<typeof repo.insertTimeOff>>) => ({
  id: row.id,
  kind: row.kind,
  startDate: row.startDate,
  endDate: row.endDate,
  note: row.note,
});

export async function listMyTimeOff(actor: Actor) {
  return (await repo.listTimeOff(db, actor.userId)).map(toTimeOffDto);
}

export async function addMyTimeOff(
  actor: Actor,
  input: { kind: string; startDate: string; endDate: string; note?: string | null },
) {
  const row = await repo.insertTimeOff(db, {
    userId: actor.userId,
    kind: input.kind,
    startDate: input.startDate,
    endDate: input.endDate,
    note: input.note?.trim() || null,
  });
  return toTimeOffDto(row);
}

export async function deleteMyTimeOff(actor: Actor, id: string) {
  if (!(await repo.deleteOwnTimeOff(db, actor.userId, id)))
    throw new NotFoundError("Time off entry", "TIME_OFF_NOT_FOUND");
}
