import { z } from "zod";

const hourMinutes = (max: number) => z.number().int().min(1).max(max);
export const ticketType = z.string().trim().min(1).max(40);
export const ticketPriority = z.string().trim().min(1).max(40);
const isoDate = z.iso.date();

export const ticketSummarySchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    sprintId: z.uuid().nullable(),
    columnId: z.uuid().nullable(),
    code: z.string(),
    title: z.string(),
    type: z.string(),
    priority: z.string(),
    assigneeId: z.uuid().nullable(),
    reporterId: z.uuid().nullable(),
    estimateMinutes: z.number().int(),
    storyPoints: z.number().int().nullable(),
    position: z.number(),
    dueDate: isoDate.nullable(),
    released: z.boolean(),
    releasedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    loggedMinutes: z.number().int(),
    epicIds: z.array(z.uuid()),
  })
  .meta({ id: "TicketSummary" });

export const ticketSchema = ticketSummarySchema
  .extend({ descriptionJson: z.unknown().describe("TipTap document") })
  .meta({ id: "Ticket" });

const description = z.record(z.string(), z.unknown()).describe("TipTap document");

export const createTicketBody = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(200, "Title must be 200 characters or fewer"),
    descriptionJson: description,
    type: ticketType,
    priority: ticketPriority,
    columnId: z.uuid().nullish(),
    sprintId: z.uuid().nullish(),
    assigneeId: z.uuid().nullish(),
    storyPoints: z.number().int().min(0).max(1000).nullish(),
    dueDate: isoDate.nullish(),
    epicIds: z.array(z.uuid()).max(50).optional(),
    estimates: z
      .array(
        z.object({
          resourceType: z.string().trim().min(1).max(120),
          minutes: z.number().int().min(0).max(59_999),
          estimatedAt: z.iso.datetime().optional(),
        }),
      )
      .max(50)
      .optional(),
  })
  .meta({ id: "CreateTicketRequest" });

export const updateTicketBody = z
  .object({
    title: createTicketBody.shape.title.optional(),
    descriptionJson: description.optional(),
    type: ticketType.optional(),
    priority: ticketPriority.optional(),
    columnId: z.uuid().nullish(),
    sprintId: z.uuid().nullish(),
    assigneeId: z.uuid().nullish(),
    storyPoints: z.number().int().min(0).max(1000).nullish(),
    dueDate: isoDate.nullish(),
    epicIds: z.array(z.uuid()).max(50).optional(),
  })
  .meta({ id: "UpdateTicketRequest" });

export const moveTicketBody = z
  .object({
    sprintId: z.uuid().nullish().describe("Omit to keep the sprint; null moves to the backlog"),
    columnId: z.uuid().nullish(),
    afterTicketId: z.uuid().nullish().describe("Ticket that will precede this one"),
    beforeTicketId: z.uuid().nullish().describe("Ticket that will follow this one"),
  })
  .meta({ id: "MoveTicketRequest" });

const ticketIds = z.array(z.uuid()).min(1).max(500);
export const bulkMoveBody = z
  .object({ ticketIds, sprintId: z.uuid().nullable() })
  .meta({ id: "BulkMoveTicketsRequest" });
export const bulkUpdateBody = z
  .object({
    ticketIds,
    set: z
      .object({
        columnId: z.uuid().nullish(),
        assigneeId: z.uuid().nullish(),
        priority: ticketPriority.optional(),
        type: ticketType.optional(),
        sprintId: z.uuid().nullish(),
        dueDate: isoDate.nullish(),
      })
      .default({}),
    addEpicIds: z.array(z.uuid()).max(50).optional(),
  })
  .refine((value) => Object.keys(value.set).length > 0 || (value.addEpicIds?.length ?? 0) > 0, {
    message: "Choose at least one field to change",
    path: ["set"],
  })
  .meta({ id: "BulkUpdateTicketsRequest" });
export const bulkDeleteBody = z.object({ ticketIds }).meta({ id: "BulkDeleteTicketsRequest" });
export const bulkDeleteResult = z
  .object({
    deleted: z.array(z.uuid()),
    skipped: z.array(z.object({ id: z.uuid(), reason: z.string() })),
  })
  .meta({ id: "BulkDeleteTicketsResult" });

export const projectParams = z.object({ projectId: z.uuid() });
export const ticketParams = z.object({ ticketId: z.uuid() });

export const estimateSchema = z
  .object({
    id: z.uuid(),
    ticketId: z.uuid(),
    resourceType: z.string(),
    minutes: z.number().int(),
    note: z.string().nullable(),
    estimatedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Estimate" });
export const addEstimateBody = z
  .object({
    resourceType: z.string().trim().min(1, "Choose a role").max(120),
    minutes: hourMinutes(59_999),
    note: z.string().trim().max(500).nullish(),
  })
  .meta({ id: "AddEstimateRequest" });
export const updateEstimateBody = z
  .object({
    resourceType: z.string().trim().min(1).max(120).optional(),
    minutes: hourMinutes(59_999).optional(),
  })
  .meta({ id: "UpdateEstimateRequest" });

export const workLogSchema = z
  .object({
    id: z.uuid(),
    ticketId: z.uuid(),
    userId: z.uuid(),
    minutes: z.number().int(),
    note: z.string().nullable(),
    resourceType: z.string().nullable(),
    loggedAt: z.iso.datetime(),
  })
  .meta({ id: "WorkLog" });
const workLogFields = {
  minutes: hourMinutes(24 * 60 * 31),
  note: z.string().trim().min(1, "Add a note").max(2000),
  loggedAt: z.iso.datetime({ offset: true }),
  userId: z.uuid().optional().describe("Managers may log for another person"),
  resourceType: z.string().trim().max(120).nullish(),
};
export const addWorkLogBody = z.object(workLogFields).meta({ id: "AddWorkLogRequest" });
export const updateWorkLogBody = z
  .object({
    ...workLogFields,
    minutes: workLogFields.minutes.optional(),
    note: workLogFields.note.optional(),
    loggedAt: workLogFields.loggedAt.optional(),
  })
  .meta({ id: "UpdateWorkLogRequest" });

export const commentSchema = z
  .object({
    id: z.uuid(),
    ticketId: z.uuid(),
    parentId: z.uuid().nullable(),
    authorId: z.uuid(),
    body: z.string().describe("Serialized TipTap JSON or legacy text"),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Comment" });
export const addCommentBody = z
  .object({
    body: z.string().max(200_000),
    parentId: z.uuid().nullish(),
    allowEmpty: z.boolean().optional().describe("True when files will be attached"),
  })
  .meta({ id: "AddCommentRequest" });
export const editCommentBody = z
  .object({ body: z.string().max(200_000) })
  .meta({ id: "EditCommentRequest" });

export const attachmentSchema = z
  .object({
    id: z.uuid(),
    ticketId: z.uuid(),
    commentId: z.uuid().nullable(),
    context: z.enum(["description", "comment"]),
    name: z.string(),
    mime: z.string().nullable(),
    size: z.number().int().nullable(),
    storagePath: z.string(),
    uploadedBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Attachment" });
