import { z } from "zod";
import { PROJECT_TYPES } from "../../database/schema/projects.js";
import { appRoleSchema } from "../access/me.schemas.js";
import { personSchema } from "../users/people.routes.js";

export const projectTypeSchema = z.enum(PROJECT_TYPES).meta({ id: "ProjectType" });

export const projectSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    key: z.string(),
    accountId: z.uuid(),
    clientAccount: z.string().nullable(),
    ownerId: z.uuid().nullable(),
    description: z.string().nullable(),
    projectType: projectTypeSchema,
    createdAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
    archivedBy: z.uuid().nullable(),
  })
  .meta({ id: "Project" });

export const projectIdParams = z.object({ projectId: z.uuid() });

const projectKey = z.string().trim().min(1, "Project key is required").max(16);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const createProjectBody = z
  .object({
    accountId: z.uuid(),
    name: z.string().trim().min(1, "Project name is required").max(120),
    key: projectKey,
    projectType: projectTypeSchema,
    clientAccount: optionalText(120),
    description: optionalText(2000),
  })
  .meta({ id: "CreateProjectRequest" });

export const updateProjectBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    key: projectKey.optional(),
    projectType: projectTypeSchema.optional(),
    clientAccount: optionalText(120),
    description: optionalText(2000),
  })
  .meta({ id: "UpdateProjectRequest" });

export const moveProjectBody = z.object({ accountId: z.uuid() }).meta({ id: "MoveProjectRequest" });

export const projectStatsSchema = z
  .object({
    projectId: z.uuid(),
    tickets: z.number().int(),
    sprints: z.number().int(),
    members: z.number().int(),
    activeSprint: z.boolean(),
    lastSprintEndsAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "ProjectStats" });

export const idsQuery = z.object({
  ids: z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(z.uuid()).max(500)),
});

export const accessibleUserSchema = personSchema
  .omit({ id: true })
  .extend({ userId: z.uuid(), role: z.union([appRoleSchema, z.literal("account_admin")]) })
  .meta({ id: "ProjectPerson" });

export const rateSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    role: z.string(),
    location: z.string().nullable(),
    hourlyRate: z.string().describe("Decimal string, 2 fraction digits"),
  })
  .meta({ id: "Rate" });

export const rateBody = z
  .object({
    role: z.string().trim().min(1, "Role is required").max(120),
    location: z.string().trim().max(120).nullish(),
    hourlyRate: z.coerce.number().min(0).max(99_999_999.99),
  })
  .meta({ id: "RateRequest" });

export const rateParams = z.object({ projectId: z.uuid(), rateId: z.uuid() });
