import { and, desc, eq } from "drizzle-orm";
import { db } from "../../database/client.js";
import { ticketEstimates } from "../../database/schema/index.js";
import { NotFoundError, ValidationError } from "../../shared/http/errors.js";
import type { Actor } from "../access/access.types.js";
import { requireManager, requireTicketReader, requireTicketWriter } from "./ticket-access.js";
import { MAX_ESTIMATE_MINUTES } from "./tickets.service.js";
import { syncEstimateTotal } from "./tickets.repository.js";

type EstimateRow = typeof ticketEstimates.$inferSelect;
const toDto = (row: EstimateRow) => ({
  id: row.id,
  ticketId: row.ticketId,
  resourceType: row.resourceType,
  minutes: row.minutes,
  note: row.note,
  estimatedAt: row.estimatedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

async function assertTotalWithinCap(ticketId: string, delta: number) {
  const rows = await db
    .select({ minutes: ticketEstimates.minutes })
    .from(ticketEstimates)
    .where(eq(ticketEstimates.ticketId, ticketId));
  if (rows.reduce((sum, row) => sum + row.minutes, 0) + delta > MAX_ESTIMATE_MINUTES)
    throw new ValidationError("Maximum estimate is 999h 59m");
}

async function requireEstimate(ticketId: string, estimateId: string) {
  const [row] = await db
    .select()
    .from(ticketEstimates)
    .where(and(eq(ticketEstimates.id, estimateId), eq(ticketEstimates.ticketId, ticketId)))
    .limit(1);
  if (!row) throw new NotFoundError("Estimate", "ESTIMATE_NOT_FOUND");
  return row;
}

export async function listEstimates(actor: Actor, ticketId: string) {
  await requireTicketReader(actor, ticketId);
  const rows = await db
    .select()
    .from(ticketEstimates)
    .where(eq(ticketEstimates.ticketId, ticketId))
    .orderBy(desc(ticketEstimates.createdAt));
  return rows.map(toDto);
}

export async function addEstimate(
  actor: Actor,
  ticketId: string,
  input: { resourceType: string; minutes: number; note?: string | null },
) {
  await requireTicketWriter(actor, ticketId);
  await assertTotalWithinCap(ticketId, input.minutes);
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(ticketEstimates)
      .values({
        ticketId,
        resourceType: input.resourceType.trim(),
        minutes: input.minutes,
        note: input.note?.trim() || null,
      })
      .returning();
    await syncEstimateTotal(tx, ticketId);
    return inserted!;
  });
  return toDto(row);
}

/** Editing and removing estimates is reserved for project managers (source UI rule). */
export async function updateEstimate(
  actor: Actor,
  ticketId: string,
  estimateId: string,
  input: { resourceType?: string; minutes?: number },
) {
  const { scope } = await requireTicketWriter(actor, ticketId);
  requireManager(actor, scope, "Only project admins can change estimates");
  const current = await requireEstimate(ticketId, estimateId);
  if (input.minutes !== undefined)
    await assertTotalWithinCap(ticketId, input.minutes - current.minutes);
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(ticketEstimates)
      .set({
        ...(input.resourceType !== undefined ? { resourceType: input.resourceType.trim() } : {}),
        ...(input.minutes !== undefined ? { minutes: input.minutes } : {}),
      })
      .where(eq(ticketEstimates.id, estimateId))
      .returning();
    await syncEstimateTotal(tx, ticketId);
    return updated!;
  });
  return toDto(row);
}

export async function deleteEstimate(actor: Actor, ticketId: string, estimateId: string) {
  const { scope } = await requireTicketWriter(actor, ticketId);
  requireManager(actor, scope, "Only project admins can remove estimates");
  await requireEstimate(ticketId, estimateId);
  await db.transaction(async (tx) => {
    await tx.delete(ticketEstimates).where(eq(ticketEstimates.id, estimateId));
    await syncEstimateTotal(tx, ticketId);
  });
}
