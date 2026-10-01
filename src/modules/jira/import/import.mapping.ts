import { AppError } from "../../../shared/http/errors.js";
import { isConnectionError } from "../jira.errors.js";
import type { ImportRow } from "./import.types.js";

const PRIORITY_MAP: Record<string, string> = {
  highest: "urgent",
  high: "high",
  medium: "medium",
  low: "low",
  lowest: "low",
};

const TYPE_MAP: Record<string, string> = {
  bug: "bug",
  defect: "bug",
  story: "story",
  epic: "epic",
  task: "task",
  "sub-task": "task",
  subtask: "task",
};

export const mapPriority = (name: string | null | undefined) =>
  PRIORITY_MAP[(name ?? "").trim().toLowerCase()] ?? "medium";

export const mapType = (name: string | null | undefined) =>
  TYPE_MAP[(name ?? "").trim().toLowerCase()] ?? "task";

export function mapSprintStatus(
  state: string | null | undefined,
): "planned" | "active" | "completed" {
  const s = (state ?? "").toLowerCase();
  if (s === "closed") return "completed";
  if (s === "active") return "active";
  return "planned";
}

const RECONNECT_MESSAGE =
  "Your Jira connection expired. Everything imported so far is saved — reconnect Jira and try again.";

export const ARCHIVED_IMPORT_MESSAGE =
  "This import is for an archived project. Restore the project, then try again.";

const GENERIC_FAILURE =
  "Something went wrong while importing from Jira. Nothing already imported was lost — please try again.";

/** An import stop whose message is written for the user. */
export class ImportStoppedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportStoppedError";
  }
}

/** Keeps raw API/database text out of the wizard. */
export function friendlyError(error: unknown): string {
  if (isConnectionError(error)) return RECONNECT_MESSAGE;
  if (error instanceof ImportStoppedError) return error.message;
  if (error instanceof AppError && error.status < 500) return error.message;
  return GENERIC_FAILURE;
}

export function toProgress(row: ImportRow, projectName?: string | null) {
  return {
    id: row.id,
    phase: row.phase,
    projectId: row.projectId,
    projectName: projectName ?? row.jiraProjectName,
    processed: row.processedIssues,
    total: row.totalIssues,
    comments: row.importedComments,
    worklogs: row.importedWorklogs,
    attachments: row.importedAttachments,
    jiraUsers: row.jiraUsers.map((e) => ({
      key: e.key,
      name: e.name,
      email: e.email,
      status: e.status,
      tickets: e.ticketIds.length,
    })),
    issueWarnings: row.warnings.length,
    needsReconnect: row.error === RECONNECT_MESSAGE,
    error: row.error,
  };
}

export type ImportProgress = ReturnType<typeof toProgress>;

/** Runs the same work a few items at a time; the order of side effects per item is kept. */
export async function runBatched<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map((item) => fn(item)));
  }
}

export const normalizeEmail = (email: string | null | undefined) =>
  (email ?? "").trim().toLowerCase();
