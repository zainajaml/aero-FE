import { db } from "../../database/client.js";
import { summarizeThread } from "../../integrations/ai/summarizer.js";
import { LIMITS, enforceRateLimit } from "../../shared/security/rate-limit.js";
import * as policy from "../access/access.policy.js";
import { requireProjectMember, visibleProjectIds } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import { listProjects } from "../projects/projects.repository.js";
import { listColumns } from "../board/board.repository.js";
import { parseCommentBody } from "../tickets/rich-text.js";
import { requireTicketReader } from "../tickets/ticket-access.js";
import { listProjectAccessibleUsers, listVisibleProfiles } from "../users/people.repository.js";
import { displayName } from "../users/names.js";
import * as repo from "./reporting.repository.js";

export async function workLogs(
  actor: Actor,
  filter: Omit<repo.WorkLogFilter, "projectIds"> & { projectIds?: string[] },
) {
  const projectIds = await visibleProjectIds(actor, filter.projectIds);
  if (projectIds.length === 0) return [];
  const rows = await repo.listWorkLogs(db, { ...filter, projectIds });
  return rows.map((row) => ({ ...row, loggedAt: row.loggedAt.toISOString() }));
}

export async function tickets(
  actor: Actor,
  filter: Omit<repo.TicketSearch, "projectIds"> & { projectIds?: string[] },
) {
  const projectIds = await visibleProjectIds(actor, filter.projectIds);
  if (projectIds.length === 0) return [];
  return (await repo.searchTickets(db, { ...filter, projectIds })).map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function sprints(
  actor: Actor,
  filter: { projectIds?: string[]; statuses?: string[] },
) {
  const projectIds = await visibleProjectIds(actor, filter.projectIds);
  if (projectIds.length === 0) return [];
  return (await repo.listSprints(db, projectIds, filter.statuses)).map((row) => ({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    goal: row.goal,
    status: row.status,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    position: row.position,
  }));
}

/**
 * People the caller may report on in My Work: themselves, plus members of projects they administer as
 * super admin or account admin (the source panel's rule, now enforced by the server).
 */
export async function reportableUsers(actor: Actor, projectIds: string[]) {
  const scoped = await visibleProjectIds(actor, projectIds);
  const projects = await listProjects(db, { ids: scoped });
  const administered = policy.isSuperAdmin(actor)
    ? projects.map((p) => p.id)
    : projects.filter((p) => policy.isAccountAdmin(actor, p.accountId)).map((p) => p.id);
  const ids = new Set([
    actor.userId,
    ...(await repo.memberUserIds(db, administered)).map((row) => row.userId),
  ]);
  const people = await listVisibleProfiles(db, actor.userId, true, [...ids]);
  return people.map((person) => ({
    id: person.id,
    displayName: displayName(person, "Unknown"),
    avatarUrl: person.avatarUrl,
  }));
}

// ------------------------------------------------------------------ RAG report

/** Source rules: ≥3 comments while ready-to-test (not deploy) → orange; logged > estimate → orange; both → red. */
const MANY_COMMENTS = 3;

export async function ragReport(actor: Actor, projectId: string) {
  await requireProjectMember(actor, projectId);
  const activeSprints = (await repo.listSprints(db, [projectId], ["active"])).map((s) => ({
    id: s.id,
    name: s.name,
  }));
  const columns = new Map((await listColumns(db, projectId)).map((c) => [c.id, c.name]));
  const sprintTickets = activeSprints.length
    ? await repo.searchTickets(db, {
        projectIds: [projectId],
        sprintIds: activeSprints.map((s) => s.id),
      })
    : [];
  const ids = sprintTickets.map((t) => t.id);
  const [logs, threadRows] = await Promise.all([
    ids.length ? repo.listWorkLogs(db, { projectIds: [projectId], ticketIds: ids }) : [],
    repo.commentsForTickets(db, ids),
  ]);
  const logged = new Map<string, number>();
  for (const log of logs) logged.set(log.ticketId, (logged.get(log.ticketId) ?? 0) + log.minutes);
  const commentCounts = new Map<string, number>();
  for (const comment of threadRows)
    commentCounts.set(comment.ticketId, (commentCounts.get(comment.ticketId) ?? 0) + 1);

  const rows = sprintTickets.map((ticket) => {
    const stageName = ticket.columnId ? (columns.get(ticket.columnId) ?? "") : "";
    const stage = stageName.toLowerCase();
    const loggedMinutes = logged.get(ticket.id) ?? 0;
    const estimate = ticket.estimateMinutes ?? 0;
    const commentCount = commentCounts.get(ticket.id) ?? 0;
    const commentOrange =
      stage.includes("test") && !stage.includes("deploy") && commentCount >= MANY_COMMENTS;
    const hoursOrange = estimate > 0 && loggedMinutes > estimate;
    const status =
      commentOrange && hoursOrange ? "red" : commentOrange || hoursOrange ? "orange" : "green";
    return {
      ticketId: ticket.id,
      code: ticket.code,
      title: ticket.title,
      stageName,
      estimateMinutes: estimate,
      loggedMinutes,
      pctSpent: estimate > 0 ? Math.round((loggedMinutes / estimate) * 10_000) / 100 : 0,
      commentCount,
      commentOrange,
      hoursOrange,
      status: status as "red" | "orange" | "green",
    };
  });
  const order = { red: 0, orange: 1, green: 2 } as const;
  rows.sort((a, b) => order[a.status] - order[b.status]);
  return {
    sprints: activeSprints,
    counts: {
      red: rows.filter((r) => r.status === "red").length,
      orange: rows.filter((r) => r.status === "orange").length,
      green: rows.filter((r) => r.status === "green").length,
    },
    rows,
  };
}

/** AI summary of a ticket's comment thread, built from stored comments (rate limited, fails closed). */
export async function commentSummary(actor: Actor, ticketId: string) {
  const { ticket } = await requireTicketReader(actor, ticketId);
  await enforceRateLimit({
    namespace: "ai:summarize_ticket_comments",
    identifier: actor.userId,
    windows: LIMITS.aiSummaryUser,
  });
  const thread = (await repo.commentsForTickets(db, [ticketId]))
    .map((comment) => ({
      authorId: comment.authorId,
      body: parseCommentBody(comment.body)
        .text.replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((comment) => comment.body)
    .slice(-60);
  if (thread.length === 0) return { issue: [], solution: [], nextSteps: [] };
  const people = new Map(
    (
      await listVisibleProfiles(db, actor.userId, true, [...new Set(thread.map((c) => c.authorId))])
    ).map((p) => [p.id, displayName(p, "User")]),
  );
  return summarizeThread(
    `${ticket.code} ${ticket.title}`.slice(0, 300),
    thread.map((comment) => ({
      author: people.get(comment.authorId) ?? "User",
      body: comment.body.slice(0, 4_000),
    })),
  );
}

// ------------------------------------------------------------------ utilisation

const WEEKLY_CAPACITY_MINUTES = 40 * 60;

/** Team utilisation for [from, to): logged / (40h per week prorated by the period length), per member and project. */
export async function utilization(actor: Actor, projectId: string, from: Date, to: Date) {
  await requireProjectMember(actor, projectId);
  const capacity =
    (Math.max(0, to.getTime() - from.getTime()) / (7 * 86_400_000)) * WEEKLY_CAPACITY_MINUTES;
  const [people, projectTickets, logs, roles] = await Promise.all([
    listProjectAccessibleUsers(db, projectId),
    repo.searchTickets(db, { projectIds: [projectId] }),
    repo.listWorkLogs(db, { projectIds: [projectId], from, to }),
    repo.projectRolesFor(db, [projectId]),
  ]);
  const ticketCode = new Map(projectTickets.map((t) => [t.id, t.code]));
  const members = new Map<string, (typeof people)[number]>();
  for (const person of people)
    if (!members.has(person.userId) || person.role === "account_admin")
      members.set(person.userId, person);
  const pct = (minutes: number) =>
    capacity > 0 ? Math.round((minutes / capacity) * 10_000) / 100 : 0;

  const result = [...members.values()].map((person) => {
    const own = logs.filter((log) => log.userId === person.userId);
    const loggedMinutes = own.reduce((sum, log) => sum + log.minutes, 0);
    const perTicket = new Map<string, number>();
    for (const log of own)
      perTicket.set(log.ticketId, (perTicket.get(log.ticketId) ?? 0) + log.minutes);
    return {
      userId: person.userId,
      displayName: displayName(person, "Unknown"),
      avatarUrl: person.avatarUrl,
      jobTitle: person.jobTitle,
      role: person.role,
      projectRole: roles.find((r) => r.userId === person.userId)?.role ?? null,
      openTicketCount: projectTickets.filter((t) => t.assigneeId === person.userId && !t.isDone)
        .length,
      loggedMinutes,
      utilization: pct(loggedMinutes),
      tickets: [...perTicket.entries()]
        .map(([ticketId, minutes]) => ({ ticketId, code: ticketCode.get(ticketId) ?? "", minutes }))
        .sort((a, b) => b.minutes - a.minutes),
    };
  });
  result.sort((a, b) => b.loggedMinutes - a.loggedMinutes);
  const teamLogged = result.reduce((sum, member) => sum + member.loggedMinutes, 0);
  return {
    capacityMinutesPerMember: Math.round(capacity),
    team: {
      loggedMinutes: teamLogged,
      utilization:
        result.length && capacity > 0
          ? Math.round((teamLogged / (result.length * capacity)) * 10_000) / 100
          : 0,
    },
    members: result,
    logs: logs
      .filter((log) => members.has(log.userId))
      .map((log) => ({
        userId: log.userId,
        minutes: log.minutes,
        loggedAt: log.loggedAt.toISOString(),
      })),
  };
}
