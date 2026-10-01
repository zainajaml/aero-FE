import { db } from "../../../database/client.js";
import { ConflictError, NotFoundError } from "../../../shared/http/errors.js";
import { logger } from "../../../shared/observability/logger.js";
import { enforceRateLimit } from "../../../shared/security/rate-limit.js";
import type { Actor } from "../../access/access.types.js";
import { writeAuditEvent } from "../../audit/audit.service.js";
import { findConnection } from "../connection.repository.js";
import { requireAccountAdmin } from "../jira.access.js";
import { jiraConfig } from "../jira.config.js";
import { JiraNotConnectedError } from "../jira.errors.js";
import { JiraSession } from "../jira-session.js";
import * as imports from "./import.repository.js";
import { runIssueSlice } from "./import.issues.js";
import {
  ARCHIVED_IMPORT_MESSAGE,
  friendlyError,
  ImportStoppedError,
  toProgress,
  type ImportProgress,
} from "./import.mapping.js";
import { runSetup } from "./import.setup.js";
import type { ImportRow } from "./import.types.js";

const START_LIMIT = [{ limit: 30, windowSeconds: 60 * 60 }];

/** The caller's own import run; anyone else's id is the same 404. */
export async function loadImport(actor: Actor, importId: string): Promise<ImportRow> {
  jiraConfig();
  const row = await imports.findImport(db, actor.userId, importId);
  if (!row) throw new NotFoundError("Import", "JIRA_IMPORT_NOT_FOUND");
  return row;
}

export type StartImportInput = {
  accountId: string;
  cloudId: string;
  jiraProjectId: string;
  jiraProjectKey: string;
  jiraProjectName: string;
};

/** Starts an import, or resumes the unfinished run of the same Jira project (never duplicates). */
export async function startImport(actor: Actor, input: StartImportInput): Promise<ImportProgress> {
  jiraConfig();
  await requireAccountAdmin(actor, input.accountId);
  await enforceRateLimit({
    namespace: "jira:import:start",
    identifier: actor.userId,
    windows: START_LIMIT,
  });
  const connection = await findConnection(db, actor.userId);
  if (!connection) throw new JiraNotConnectedError();
  if (connection.cloudId !== input.cloudId) {
    throw new ConflictError(
      "That Jira site is not the one currently connected. Refresh the page and try again.",
      "JIRA_SITE_MISMATCH",
    );
  }

  const existing = await imports.findResumable(db, { userId: actor.userId, ...input });
  let progress: ImportProgress;
  if (existing) {
    const phase =
      existing.phase === "error" ? (existing.projectId ? "issues" : "setup") : existing.phase;
    await imports.patchImport(db, existing.id, { phase, error: null });
    progress = toProgress({ ...existing, phase, error: null });
  } else {
    const row = await imports.insertImport(db, {
      userId: actor.userId,
      accountId: input.accountId,
      cloudId: input.cloudId,
      jiraProjectId: input.jiraProjectId,
      jiraProjectKey: input.jiraProjectKey,
      jiraProjectName: input.jiraProjectName,
      phase: "setup",
    });
    progress = toProgress(row);
  }
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "create",
    event: "jira.import_started",
    table: "jira_imports",
    entityId: progress.id,
    projectId: progress.projectId,
    accountId: input.accountId,
    link: "/jira",
    summary: `Started a Jira import for ${input.jiraProjectKey}`,
    metadata: { jira_project_key: input.jiraProjectKey },
    critical: true,
  });
  return progress;
}

export async function getImport(actor: Actor, importId: string): Promise<ImportProgress> {
  return toProgress(await loadImport(actor, importId));
}

async function advance(actor: Actor, row: ImportRow, importerIsAccountAdmin: boolean) {
  if (row.projectId) {
    const target = await imports.findProjectBrief(db, row.projectId);
    if (target?.archivedAt) throw new ImportStoppedError(ARCHIVED_IMPORT_MESSAGE);
  }
  // Bound to the import's site: switching sites mid-import stops instead of mixing data.
  const session = new JiraSession(actor.userId, row.cloudId);
  if (row.phase === "setup" || !row.projectId)
    return runSetup(session, row, importerIsAccountAdmin);
  return runIssueSlice(session, row);
}

/** Runs one bounded slice (setup, or the next ISSUES_PER_STEP issues); the client loops. */
export async function stepImport(actor: Actor, importId: string): Promise<ImportProgress> {
  const row = await loadImport(actor, importId);
  if (row.phase === "done") return toProgress(row);
  const access = await requireAccountAdmin(actor, row.accountId);
  let next: ImportRow;
  try {
    next = await advance(actor, row, access.isAccountAdmin);
  } catch (error) {
    // Paused, never rolled back: stored Jira ids let a retry resume without duplicates.
    // Only the error class and status are logged (driver and API messages may carry PII).
    logger.warn(
      {
        importId: row.id,
        error: error instanceof Error ? error.name : "unknown",
        status: (error as { status?: unknown })?.status ?? null,
      },
      "jira import step failed",
    );
    const message = friendlyError(error);
    await imports.patchImport(db, row.id, { phase: "error", error: message });
    next = { ...row, phase: "error", error: message };
  }
  const after = toProgress(next);
  // Only the transition into a terminal phase is audited: one event per import, not per slice.
  if (row.phase !== next.phase && (next.phase === "done" || next.phase === "error")) {
    await writeAuditEvent({
      actorUserId: actor.userId,
      action: "update",
      event: next.phase === "done" ? "jira.import_completed" : "jira.import_failed",
      table: "jira_imports",
      entityId: after.id,
      projectId: after.projectId,
      link: "/jira",
      summary: `Jira import ${next.phase === "done" ? "finished" : "failed"} for ${
        after.projectName ?? "project"
      }`,
      metadata: {
        issues_processed: after.processed,
        issues_total: after.total,
        comments: after.comments,
        worklogs: after.worklogs,
        attachments: after.attachments,
        people: after.jiraUsers.length,
        warnings: after.issueWarnings,
        ...(next.phase === "error" ? { reason: after.error ?? "unknown error" } : {}),
      },
      critical: true,
    });
  }
  return after;
}
