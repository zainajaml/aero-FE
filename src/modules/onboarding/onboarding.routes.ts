import { z } from "zod";
import { PROJECT_TYPES } from "../../database/schema/projects.js";
import { defineRoute } from "../../shared/http/route.js";
import { appRoleSchema } from "../access/me.schemas.js";
import * as service from "./onboarding.service.js";

const tags = ["onboarding"];
const projectType = z.enum(PROJECT_TYPES).meta({ id: "ProjectType" });
const personName = z.string().trim().max(80).nullish();

const onboardingState = z
  .object({
    accountId: z.uuid().nullable(),
    accountName: z.string().nullable(),
    projectId: z.uuid().nullable(),
    projectName: z.string().nullable(),
    projectKey: z.string().nullable(),
    projectType: projectType.nullable(),
    roles: z.array(appRoleSchema),
    hasMembership: z.boolean(),
  })
  .meta({ id: "OnboardingState" });

export const onboardingRoutes = [
  defineRoute({
    method: "get",
    path: "/onboarding",
    operationId: "getOnboardingState",
    summary: "Resume point of the self-serve onboarding wizard",
    tags,
    response: { status: 200, schema: onboardingState },
    handler: ({ actor }) => service.getOnboardingState(actor),
  }),
  defineRoute({
    method: "post",
    path: "/onboarding/workspace",
    operationId: "createOnboardingWorkspace",
    summary: "Create (or rename) the caller's workspace and make them its account admin",
    tags,
    request: {
      body: z
        .object({
          name: z
            .string()
            .trim()
            .min(2, "Workspace name is required")
            .max(60, "Workspace name must be 60 characters or fewer"),
          firstName: personName,
          lastName: personName,
        })
        .meta({ id: "CreateWorkspaceRequest" }),
    },
    response: {
      status: 200,
      schema: z
        .object({ accountId: z.uuid(), role: z.literal("account_admin") })
        .meta({ id: "CreateWorkspaceResult" }),
    },
    errors: [409],
    handler: ({ actor, body }) => service.createWorkspace(actor, body),
  }),
  defineRoute({
    method: "post",
    path: "/onboarding/first-project",
    operationId: "createOnboardingProject",
    summary: "Create (or update) the first project of the caller's workspace",
    tags,
    request: {
      body: z
        .object({
          accountId: z.uuid(),
          name: z.string().trim().min(1, "Project name is required").max(80),
          key: z.string().trim().min(1, "Project key is required").max(16),
          projectType,
          projectId: z.uuid().nullish(),
        })
        .meta({ id: "CreateFirstProjectRequest" }),
    },
    response: {
      status: 200,
      schema: z
        .object({ projectId: z.uuid(), projectName: z.string() })
        .meta({ id: "CreateFirstProjectResult" }),
    },
    errors: [403, 409],
    handler: ({ actor, body }) => service.createFirstProject(actor, body),
  }),
];
