import { z } from "zod";
import { defineRoute } from "../../shared/http/route.js";
import * as preferences from "./preferences.service.js";

const tags = ["notifications"];

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
];
