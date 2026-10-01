import type { jiraImports } from "../../../database/schema/index.js";

type ImportPhase = "setup" | "issues" | "done" | "error";
export type ImportProjectType = "sprint" | "kanban";

/** A Jira person as it appears on issues, comments and work logs. */
export type JiraPerson = {
  accountId?: string;
  displayName?: string;
  emailAddress?: string | null;
};

/**
 * One row per UNIQUE Jira person (keyed by Jira account id when available):
 *  - matched    → already has an account here; assignments are preserved
 *  - invitable  → provisional identity created from the Jira email; can be invited
 *  - unmatched  → Jira hid the email; needs a manual match
 */
export type JiraUserEntry = {
  key: string;
  accountId: string | null;
  name: string | null;
  email: string | null;
  status: "matched" | "invitable" | "unmatched";
  userId: string | null;
  ticketIds: string[];
  /** Stand-in identity carrying the person's name on comments/time logs while unmatched. */
  placeholderId?: string | null;
};

type DbRow = typeof jiraImports.$inferSelect;

/** jira_imports row with its JSON columns typed. */
export type ImportRow = Omit<
  DbRow,
  "phase" | "projectType" | "sprintMap" | "newUsers" | "jiraUsers" | "warnings"
> & {
  phase: ImportPhase;
  projectType: ImportProjectType;
  sprintMap: Record<string, string>;
  newUsers: { email: string; name: string | null }[];
  jiraUsers: JiraUserEntry[];
  warnings: string[];
};

export function toImportRow(raw: DbRow): ImportRow {
  const jiraUsers = Array.isArray(raw.jiraUsers) ? (raw.jiraUsers as JiraUserEntry[]) : [];
  return {
    ...raw,
    phase: raw.phase as ImportPhase,
    projectType: raw.projectType === "sprint" ? "sprint" : "kanban",
    sprintMap: (raw.sprintMap as Record<string, string> | null) ?? {},
    newUsers: Array.isArray(raw.newUsers) ? (raw.newUsers as ImportRow["newUsers"]) : [],
    jiraUsers: jiraUsers.map((e) => ({ ...e, ticketIds: e.ticketIds ?? [] })),
    warnings: Array.isArray(raw.warnings) ? (raw.warnings as string[]) : [],
  };
}

type JiraAttachmentRef = {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
  created?: string;
  author?: JiraPerson;
  content: string;
};

export type JiraIssueRecord = {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: { name?: string };
    issuetype?: { name?: string };
    priority?: { name?: string };
    assignee?: JiraPerson | null;
    reporter?: JiraPerson | null;
    created?: string;
    updated?: string;
    duedate?: string | null;
    timeoriginalestimate?: number | null;
    parent?: { key?: string; fields?: { summary?: string; issuetype?: { name?: string } } };
    attachment?: JiraAttachmentRef[];
    comment?: {
      comments?: { id: string; author?: JiraPerson; created?: string; body?: unknown }[];
    };
    worklog?: {
      worklogs?: {
        id: string;
        author?: JiraPerson;
        started?: string;
        timeSpentSeconds?: number;
        comment?: unknown;
      }[];
    };
  };
};

export type JiraSprintValue = {
  id: number;
  name?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
};
