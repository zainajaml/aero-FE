import { db } from "../../database/client.js";
import { NotFoundError } from "../../shared/http/errors.js";
import { defineRoute } from "../../shared/http/route.js";
import { findProfile } from "../users/profiles.repository.js";
import { accessEvents } from "./access-events.js";
import { getAccessSummary, loadActor } from "./access.service.js";
import { accessSummarySchema, meSchema } from "./me.schemas.js";

export const meRoutes = [
  defineRoute({
    method: "get",
    path: "/me",
    operationId: "getMe",
    summary: "The signed-in user's identity and profile",
    tags: ["me"],
    response: { status: 200, schema: meSchema },
    errors: [403, 404],
    handler: async ({ actor }) => {
      const profile = await findProfile(db, actor.userId);
      if (!profile) throw new NotFoundError("Profile");
      return {
        id: actor.userId,
        email: actor.email,
        emailVerified: actor.emailVerified,
        fullName: profile.fullName,
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatarUrl: profile.avatarUrl,
        jobTitle: profile.jobTitle,
        timezone: profile.timezone,
      };
    },
  }),
  defineRoute({
    method: "get",
    path: "/me/access",
    operationId: "getMyAccess",
    summary: "Roles, memberships and the app-gate status for the signed-in user",
    tags: ["me"],
    response: { status: 200, schema: accessSummarySchema },
    errors: [403],
    handler: ({ actor }) => getAccessSummary(actor),
  }),
  defineRoute({
    method: "get",
    path: "/me/access-events",
    operationId: "streamMyAccessEvents",
    summary: "Server-sent events: `changed` whenever the caller's roles or memberships change",
    tags: ["me"],
    response: {
      status: 200,
      eventStream:
        "Event stream: `ready` on connect, `changed` on access changes, comment heartbeats every 25s",
    },
    handler: ({ req, res, actor }) =>
      new Promise<void>((resolve) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write("event: ready\ndata: {}\n\n");
        const unsubscribe = accessEvents.subscribe(actor.userId, () => {
          res.write("event: changed\ndata: {}\n\n");
          // An archived identity loses its stream as well as its session.
          void loadActor(actor.userId).then((current) => {
            if (!current || current.isArchived) res.end();
          });
        });
        const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
          resolve();
        });
      }),
  }),
];
