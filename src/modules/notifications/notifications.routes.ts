import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import * as log from "./log.service.js";
import * as preferences from "./preferences.service.js";

const tags = ["notifications"];

const notificationRow = z
  .object({
    id: z.uuid(),
    templateName: z.string(),
    recipient: z.string(),
    status: z.string(),
    subject: z.string().nullable(),
    errorMessage: z.string().nullable(),
    createdAt: z.iso.datetime(),
    kind: z.string().nullable(),
    author: z.string().nullable(),
    projectId: z.string().nullable(),
    ticketId: z.string().nullable(),
    ticketCode: z.string().nullable(),
    ticketTitle: z.string().nullable(),
  })
  .meta({ id: "NotificationRow" });

export const notificationRoutes = [
  defineRoute({
    method: "get",
    path: "/me/notification-preferences",
    operationId: "getMyNotificationPreferences",
    summary: "Notification preferences as trigger key → enabled (missing keys mean enabled)",
    tags,
    response: {
      status: 200,
      schema: z.record(z.string(), z.boolean()).meta({ id: "NotificationPreferences" }),
    },
    handler: ({ actor }) => preferences.getPreferences(actor),
  }),
  defineRoute({
    method: "put",
    path: "/me/notification-preferences/:key",
    operationId: "setMyNotificationPreference",
    summary: "Turn one notification trigger on or off",
    tags,
    request: {
      params: z.object({
        key: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[a-z0-9-]+$/),
      }),
      body: z.object({ enabled: z.boolean() }).meta({ id: "SetNotificationPreferenceRequest" }),
    },
    response: {
      status: 200,
      schema: z
        .object({ key: z.string(), enabled: z.boolean() })
        .meta({ id: "NotificationPreference" }),
    },
    handler: ({ actor, params, body }) =>
      preferences.setPreference(actor, params.key, body.enabled),
  }),
  defineRoute({
    method: "get",
    path: "/notifications",
    operationId: "listNotifications",
    summary: "Notification log visible to the caller, newest first",
    tags,
    request: {
      query: z.object({
        projectId: z.uuid().optional(),
        failed: z.enum(["true", "false"]).optional(),
        q: z.string().max(200).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce
          .number()
          .int()
          .refine((n) => [50, 100, 200].includes(n), "Use 50, 100 or 200")
          .default(50),
      }),
    },
    response: {
      status: 200,
      schema: z
        .object({
          items: z.array(notificationRow),
          total: z.number().int(),
          failedCount: z.number().int(),
        })
        .meta({ id: "NotificationLog" }),
    },
    handler: ({ actor, query }) =>
      log.listNotifications(actor, {
        projectId: query.projectId,
        failedOnly: query.failed === "true",
        search: query.q,
        page: query.page,
        pageSize: query.pageSize,
      }),
  }),
  defineRoute({
    method: "get",
    path: "/notifications/unseen-count",
    operationId: "countUnseenNotifications",
    summary: "Personal notifications since a time (sidebar badge)",
    tags,
    request: {
      query: z.object({
        since: z.iso
          .datetime({ offset: true })
          .optional()
          .transform((v) => (v ? new Date(v) : undefined)),
      }),
    },
    response: {
      status: 200,
      schema: z.object({ count: z.number().int() }).meta({ id: "UnseenNotificationCount" }),
    },
    handler: ({ actor, query }) => log.unseenCount(actor, query.since),
  }),
  defineRoute({
    method: "get",
    path: "/notifications/:notificationId",
    operationId: "getNotification",
    summary: "One notification with its rendered HTML",
    tags,
    request: { params: z.object({ notificationId: z.uuid() }) },
    response: {
      status: 200,
      schema: notificationRow
        .extend({ html: z.string().nullable() })
        .meta({ id: "NotificationDetail" }),
    },
    errors: [404],
    handler: ({ actor, params }) => log.notificationDetail(actor, params.notificationId),
  }),
  defineRoute({
    method: "post",
    path: "/notifications/:notificationId/retry",
    operationId: "retryNotification",
    summary: "Re-send a failed notification (admins, within scope)",
    tags,
    request: { params: z.object({ notificationId: z.uuid() }) },
    response: {
      status: 200,
      schema: z
        .object({ status: z.string(), logId: z.uuid().optional() })
        .meta({ id: "RetryNotificationResult" }),
    },
    errors: [403, 404, 409, 429],
    handler: ({ actor, params }) => log.retryNotification(actor, params.notificationId),
  }),
];
