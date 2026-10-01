import { z } from "zod";

// Identifiers are validated before they reach Jira API paths or JQL.
const jiraCloudId = z
  .string()
  .trim()
  .min(1, "A Jira site is required")
  .max(64, "Invalid Jira site")
  .regex(/^[A-Za-z0-9-]+$/, "Invalid Jira site");
const jiraProjectKey = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{1,32}$/, "A valid Jira project key is required");
const jiraNumericId = z
  .string()
  .trim()
  .regex(/^[0-9]{1,20}$/, "Pick a Jira project first");

export const importIdParams = z.object({ importId: z.uuid() });
export const jiraProjectIdParams = z.object({ jiraProjectId: jiraNumericId });

export const statusSchema = z
  .object({
    connected: z.boolean(),
    configured: z.boolean(),
    cloudId: z.string().optional(),
    siteName: z.string().nullable().optional(),
    siteUrl: z.string().nullable().optional(),
    expiresAt: z.iso.datetime().optional(),
    callbackUrl: z.string().nullable().describe("OAuth redirect URI registered in Atlassian"),
  })
  .meta({ id: "JiraStatus" });

export const connectResult = z
  .object({ authorizeUrl: z.url().describe("Atlassian consent URL; open it in a popup or tab") })
  .meta({ id: "JiraConnectResult" });

export const callbackQuery = z.object({
  code: z.string().max(4096).optional(),
  state: z.string().max(512).optional(),
  error: z.string().max(512).optional(),
  error_description: z.string().max(2048).optional(),
});

export const callbackPage = z.string().meta({
  id: "JiraOAuthCallbackPage",
  description:
    "Browser redirect target. Responds with a small text/html page (not the JSON envelope) that " +
    "notifies the opener window and closes, or redirects to the app's /jira page.",
});

export const siteSchema = z
  .object({
    cloudId: z.string(),
    name: z.string().nullable(),
    url: z.string().nullable(),
    active: z.boolean(),
  })
  .meta({ id: "JiraSite" });

export const selectSiteBody = z
  .object({ cloudId: jiraCloudId })
  .meta({ id: "JiraSelectSiteRequest" });

export const projectSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    projectTypeKey: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  })
  .meta({ id: "JiraProject" });

export const issuesQuery = z.object({
  projectKey: jiraProjectKey,
  query: z.string().trim().max(120).optional(),
  maxResults: z.coerce.number().int().min(1).max(5000).default(2000),
});

const issueSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    summary: z.string(),
    status: z.string().nullable(),
    issueType: z.string().nullable(),
    priority: z.string().nullable(),
    assignee: z.string().nullable(),
    reporter: z.string().nullable(),
    created: z.string().nullable(),
    updated: z.string().nullable(),
    attachments: z.array(
      z.object({
        id: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        size: z.number(),
        created: z.string(),
        author: z.string().nullable(),
        contentUrl: z.string(),
      }),
    ),
    comments: z.array(
      z.object({
        id: z.string(),
        author: z.string().nullable(),
        created: z.string().nullable(),
        body: z.string(),
      }),
    ),
    commentTotal: z.number().int(),
    worklogs: z.array(
      z.object({
        id: z.string(),
        author: z.string().nullable(),
        started: z.string().nullable(),
        timeSpentSeconds: z.number(),
        comment: z.string(),
      }),
    ),
    worklogTotal: z.number().int(),
    timeSpentSeconds: z.number(),
    originalEstimateSeconds: z.number().nullable(),
  })
  .meta({ id: "JiraIssue" });

export const issueSearchResult = z
  .object({ issues: z.array(issueSchema), total: z.number().int() })
  .meta({ id: "JiraIssueSearchResult" });

export const startImportBody = z
  .object({
    accountId: z.uuid(),
    cloudId: jiraCloudId,
    jiraProjectId: jiraNumericId,
    jiraProjectKey,
    jiraProjectName: z.string().trim().min(1).max(200),
  })
  .meta({ id: "JiraStartImportRequest" });

export const importProgressSchema = z
  .object({
    id: z.uuid(),
    phase: z.enum(["setup", "issues", "done", "error"]),
    projectId: z.uuid().nullable(),
    projectName: z.string().nullable(),
    processed: z.number().int(),
    total: z.number().int(),
    comments: z.number().int(),
    worklogs: z.number().int(),
    attachments: z.number().int(),
    jiraUsers: z.array(
      z.object({
        key: z.string(),
        name: z.string().nullable(),
        email: z.string().nullable(),
        status: z.enum(["matched", "invitable", "unmatched"]),
        tickets: z.number().int(),
      }),
    ),
    issueWarnings: z.number().int(),
    needsReconnect: z.boolean(),
    error: z.string().nullable(),
  })
  .meta({ id: "JiraImportProgress" });

export const candidateSchema = z
  .object({ id: z.uuid(), name: z.string(), email: z.string().nullable() })
  .meta({ id: "JiraImportCandidate" });

export const inviteBody = z
  .object({
    emails: z.array(z.string().trim().min(3).max(320).pipe(z.email())).max(100).default([]),
  })
  .meta({ id: "JiraInviteImportedUsersRequest" });

export const inviteResult = z
  .object({ sent: z.number().int(), failed: z.array(z.string()) })
  .meta({ id: "JiraInviteImportedUsersResult" });

export const assignBody = z
  .object({
    mappings: z
      .array(z.object({ key: z.string().trim().min(1).max(128), userId: z.uuid() }))
      .max(200)
      .default([]),
  })
  .meta({ id: "JiraAssignImportUsersRequest" });

export const assignResult = z
  .object({ assigned: z.number().int(), progress: importProgressSchema })
  .meta({ id: "JiraAssignImportUsersResult" });

export const importedQuery = z.object({
  accountId: z.uuid(),
  cloudId: jiraCloudId.optional(),
});

export const importedResult = z
  .object({
    imported: z.boolean(),
    projectId: z.uuid().nullable(),
    projectName: z.string().nullable(),
    tickets: z.number().int(),
  })
  .meta({ id: "JiraImportedProjectCheck" });

export const repairBody = z
  .object({
    afterTicketId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    limit: z.number().int().min(1).max(200).default(40),
  })
  .meta({ id: "JiraRepairAttributionRequest" });

export const repairResult = z
  .object({
    done: z.boolean(),
    lastTicketId: z.uuid().nullable(),
    comments: z.number().int(),
    worklogs: z.number().int(),
    unresolvedAuthors: z.array(
      z.object({ accountId: z.string().nullable(), name: z.string(), worklogs: z.number().int() }),
    ),
  })
  .meta({ id: "JiraRepairAttributionResult" });
