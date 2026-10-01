import { z } from "zod";
import { env } from "../../config/env.js";
import { defineRoute } from "../../shared/http/route.js";
import { rateLimitByRequest } from "../../shared/security/rate-limit.js";
import * as browse from "./browse.service.js";
import { sendCallbackPage } from "./callback-page.js";
import * as connection from "./connection.service.js";
import * as people from "./import/import-people.service.js";
import { repairAttribution } from "./import/import.repair.js";
import * as importer from "./import/import.service.js";
import { isJiraConfigured } from "./jira.config.js";
import * as s from "./jira.schemas.js";

const tags = ["jira"];

export const jiraRoutes = [
  defineRoute({
    method: "get",
    path: "/jira/status",
    operationId: "getJiraStatus",
    summary: "Whether Jira is configured and connected for the signed-in user (never 503)",
    tags,
    response: { status: 200, schema: s.statusSchema },
    handler: ({ actor }) => connection.getStatus(actor),
  }),
  defineRoute({
    method: "post",
    path: "/jira/connect",
    operationId: "startJiraConnect",
    summary: "Create a single-use OAuth state and return the Atlassian consent URL",
    tags,
    response: { status: 200, schema: s.connectResult },
    errors: [429, 503],
    handler: ({ actor }) => connection.startLogin(actor),
  }),
  defineRoute({
    method: "get",
    path: "/jira/oauth/callback",
    operationId: "completeJiraOAuth",
    summary: "Atlassian OAuth redirect target (public; answers with an HTML page)",
    tags,
    auth: false,
    middleware: [rateLimitByRequest("jira:oauth-callback", [{ limit: 30, windowSeconds: 600 }])],
    request: { query: s.callbackQuery },
    response: { status: 200, schema: s.callbackPage },
    errors: [429],
    handler: async ({ res, query }) => {
      const outcome = isJiraConfigured()
        ? await connection.completeLogin(query)
        : {
            title: "Jira connection failed",
            message: "The Jira integration is not configured.",
            status: "error" as const,
            result: "error" as const,
          };
      sendCallbackPage(res, outcome, env.APP_URL);
    },
  }),
  defineRoute({
    method: "delete",
    path: "/jira/connection",
    operationId: "disconnectJira",
    summary: "Forget the signed-in user's Jira connection",
    tags,
    response: { status: 204 },
    errors: [503],
    handler: ({ actor }) => connection.disconnect(actor),
  }),
  defineRoute({
    method: "get",
    path: "/jira/sites",
    operationId: "listJiraSites",
    summary: "Atlassian sites the connection granted (empty when not connected)",
    tags,
    response: { status: 200, schema: z.array(s.siteSchema) },
    errors: [503],
    handler: ({ actor }) => connection.listSites(actor),
  }),
  defineRoute({
    method: "put",
    path: "/jira/site",
    operationId: "selectJiraSite",
    summary: "Switch the connection to another granted Atlassian site",
    tags,
    request: { body: s.selectSiteBody },
    response: { status: 200, schema: s.siteSchema },
    errors: [404, 409, 502, 503],
    handler: ({ actor, body }) => connection.selectSite(actor, body.cloudId),
  }),
  defineRoute({
    method: "get",
    path: "/jira/projects",
    operationId: "listJiraProjects",
    summary: "Jira projects of the connected site (empty when not connected)",
    tags,
    response: { status: 200, schema: z.array(s.projectSchema) },
    errors: [409, 502, 503],
    handler: ({ actor }) => browse.listProjects(actor),
  }),
  defineRoute({
    method: "get",
    path: "/jira/issues",
    operationId: "searchJiraIssues",
    summary: "Issues of a Jira project, newest first, optionally filtered by text",
    tags,
    request: { query: s.issuesQuery },
    response: { status: 200, schema: s.issueSearchResult },
    errors: [409, 502, 503],
    handler: ({ actor, query }) => browse.searchIssues(actor, query),
  }),
  defineRoute({
    method: "get",
    path: "/jira/projects/:jiraProjectId/imported",
    operationId: "checkJiraProjectImported",
    summary: "Whether a Jira project was already imported into an account (account admins)",
    tags,
    request: { params: s.jiraProjectIdParams, query: s.importedQuery },
    response: { status: 200, schema: s.importedResult },
    errors: [403, 503],
    handler: ({ actor, params, query }) =>
      people.checkProjectImported(actor, { ...query, jiraProjectId: params.jiraProjectId }),
  }),
  defineRoute({
    method: "post",
    path: "/jira/imports",
    operationId: "startJiraImport",
    summary: "Start (or resume) importing a Jira project into an account (account admins)",
    tags,
    request: { body: s.startImportBody },
    response: { status: 201, schema: s.importProgressSchema },
    errors: [403, 409, 429, 503],
    handler: ({ actor, body }) => importer.startImport(actor, body),
  }),
  defineRoute({
    method: "get",
    path: "/jira/imports/:importId",
    operationId: "getJiraImport",
    summary: "Progress of one of the caller's imports",
    tags,
    request: { params: s.importIdParams },
    response: { status: 200, schema: s.importProgressSchema },
    errors: [404, 503],
    handler: ({ actor, params }) => importer.getImport(actor, params.importId),
  }),
  defineRoute({
    method: "post",
    path: "/jira/imports/:importId/step",
    operationId: "stepJiraImport",
    summary: "Process the next bounded slice (setup, then 50 issues per call); the client loops",
    tags,
    request: { params: s.importIdParams },
    response: { status: 200, schema: s.importProgressSchema },
    errors: [403, 404, 503],
    handler: ({ actor, params }) => importer.stepImport(actor, params.importId),
  }),
  defineRoute({
    method: "get",
    path: "/jira/imports/:importId/candidates",
    operationId: "listJiraImportCandidates",
    summary: "People of the import's account an unmatched Jira person can be matched to",
    tags,
    request: { params: s.importIdParams },
    response: { status: 200, schema: z.array(s.candidateSchema) },
    errors: [403, 404, 503],
    handler: ({ actor, params }) => people.listImportCandidates(actor, params.importId),
  }),
  defineRoute({
    method: "post",
    path: "/jira/imports/:importId/assign-users",
    operationId: "assignJiraImportUsers",
    summary: "Match unresolved Jira people to users and reassign their tickets",
    tags,
    request: { params: s.importIdParams, body: s.assignBody },
    response: { status: 200, schema: s.assignResult },
    errors: [403, 404, 409, 503],
    handler: ({ actor, params, body }) =>
      people.assignImportUsers(actor, params.importId, body.mappings),
  }),
  defineRoute({
    method: "post",
    path: "/jira/imports/:importId/invite-users",
    operationId: "inviteJiraImportedUsers",
    summary: "Invite people found in the import to its project",
    tags,
    request: { params: s.importIdParams, body: s.inviteBody },
    response: { status: 200, schema: s.inviteResult },
    errors: [403, 404, 409, 429, 503],
    handler: ({ actor, params, body }) =>
      people.inviteImportedUsers(actor, params.importId, body.emails),
  }),
  defineRoute({
    method: "post",
    path: "/jira/imports/:importId/repair-attribution",
    operationId: "repairJiraImportAttribution",
    summary: "Re-point imported comments and time logs at their matched Jira authors (paged)",
    tags,
    request: { params: s.importIdParams, body: s.repairBody },
    response: { status: 200, schema: s.repairResult },
    errors: [403, 404, 409, 502, 503],
    handler: ({ actor, params, body }) => repairAttribution(actor, params.importId, body),
  }),
];
