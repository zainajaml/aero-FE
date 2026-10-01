import { db } from "../../database/client.js";
import type { Actor } from "../access/access.types.js";
import * as repo from "./preferences.repository.js";

/** The legacy boolean column is authoritative for (and kept in sync with) this trigger key. */
export const TICKET_ASSIGNED_KEY = "ticket-assigned";

/** Every preference the user set, as key → enabled. Missing keys mean "on". */
export async function getPreferences(actor: Actor): Promise<Record<string, boolean>> {
  const row = await repo.findPreferences(db, actor.userId);
  const prefs = { ...(row?.prefs ?? {}) };
  if (row) prefs[TICKET_ASSIGNED_KEY] = row.ticketAssignmentEmail;
  return prefs;
}

export async function setPreference(actor: Actor, key: string, enabled: boolean) {
  const current = await repo.findPreferences(db, actor.userId);
  const prefs = { ...(current?.prefs ?? {}), [key]: enabled };
  await repo.upsertPreferences(db, actor.userId, {
    prefs,
    ...(key === TICKET_ASSIGNED_KEY ? { ticketAssignmentEmail: enabled } : {}),
  });
  return { key, enabled };
}

/** Recipients whose preference for `key` is on (missing rows / keys default to on). */
export async function filterByPreference(userIds: string[], key: string): Promise<string[]> {
  const rows = await repo.preferencesFor(db, userIds);
  const disabled = new Set(
    rows
      .filter((row) =>
        key === TICKET_ASSIGNED_KEY
          ? row.ticketAssignmentEmail === false
          : row.prefs[key] === false,
      )
      .map((row) => row.userId),
  );
  return userIds.filter((id) => !disabled.has(id));
}
