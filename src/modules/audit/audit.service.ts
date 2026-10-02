import type { DbExecutor } from "../../database/client.js";
import { db } from "../../database/client.js";
import { auditLogs } from "../../database/schema/index.js";
import { logger } from "../../shared/observability/logger.js";

type AuditAction = "create" | "read" | "update" | "delete";

/** Actor used when an operation is genuinely system initiated. */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

export type AuditEvent = {
  actorUserId: string | null;
  action: AuditAction;
  /** Event name, e.g. "invitation.created" (stored in the `field` column, as in the source). */
  event: string;
  table: string;
  entityId?: string | null;
  projectId?: string | null;
  accountId?: string | null;
  link?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  /** Security-critical events are logged at error level when the audit write fails. */
  critical?: boolean;
};

const SECRET_KEY =
  /token|secret|password|passwd|pwd|hash|authorization|auth_header|cookie|api_?key|encryption|envelope|credential|private_key|code$/i;

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(scalar).filter((part): part is string => Boolean(part));
    return parts.length ? parts.slice(0, 10).join("|").slice(0, 200) : null;
  }
  return null;
}

/** Drops secret-looking keys and reduces values to short scalars. */
function sanitizeMetadata(metadata: Record<string, unknown>): string[] {
  return Object.entries(metadata).flatMap(([key, raw]) => {
    if (SECRET_KEY.test(key)) return [];
    const value = scalar(raw);
    return value ? [`${key}=${value}`] : [];
  });
}

/**
 * Writes one audit record. Never throws: audit logging must not fail a business operation that
 * already succeeded. Pass a transaction executor to make the record part of the same commit.
 */
export async function writeAuditEvent(event: AuditEvent, executor: DbExecutor = db): Promise<void> {
  try {
    const parts = [
      ...(event.summary ? [event.summary] : []),
      ...sanitizeMetadata({
        ...(event.entityId ? { id: event.entityId } : {}),
        ...(event.accountId ? { account: event.accountId } : {}),
        ...(event.metadata ?? {}),
      }),
    ];
    await executor.insert(auditLogs).values({
      userId: event.actorUserId ?? SYSTEM_ACTOR_ID,
      action: event.action,
      tableName: event.table.slice(0, 200),
      field: event.event.slice(0, 200),
      value: parts.join(" · ").slice(0, 2000) || event.event,
      link: event.link ? event.link.slice(0, 500) : null,
      projectId: event.projectId ?? null,
    });
  } catch (error) {
    logger[event.critical ? "error" : "warn"](
      { err: error, event: event.event },
      "audit write failed",
    );
  }
}
