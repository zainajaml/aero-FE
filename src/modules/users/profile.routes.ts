import { z } from "zod";
import { EMPLOYMENT_STATUSES } from "../../database/schema/profile-private.js";
import { TIMEZONES } from "../../database/schema/profiles.js";
import { TIME_OFF_KINDS } from "../../database/schema/time-off.js";
import { defineRoute } from "../../shared/http/route.js";
import { meSchema } from "../access/me.schemas.js";
import { MB, singleFile } from "../files/upload.js";
import * as service from "./profile.service.js";

const tags = ["me"];
const isoDate = z.iso.date();

const privateSchema = z
  .object({
    mobile: z.string().nullable(),
    employeeNumber: z.string().nullable(),
    employmentStatus: z.enum(EMPLOYMENT_STATUSES).nullable(),
  })
  .meta({ id: "PrivateProfile" });

const timeOffSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(TIME_OFF_KINDS),
    startDate: isoDate,
    endDate: isoDate,
    note: z.string().nullable(),
  })
  .meta({ id: "TimeOff" });

export const profileRoutes = [
  defineRoute({
    method: "get",
    path: "/me",
    operationId: "getMe",
    summary: "The signed-in user's identity and profile",
    tags,
    response: { status: 200, schema: meSchema },
    errors: [403, 404],
    handler: ({ actor }) => service.getMe(actor),
  }),
  defineRoute({
    method: "patch",
    path: "/me/profile",
    operationId: "updateMyProfile",
    summary: "Edit your own name and timezone",
    tags,
    request: {
      body: z
        .object({
          firstName: z.string().trim().max(80).nullish(),
          lastName: z.string().trim().max(80).nullish(),
          timezone: z.enum(TIMEZONES).optional(),
        })
        .meta({ id: "UpdateMyProfileRequest" }),
    },
    response: { status: 200, schema: meSchema },
    handler: ({ actor, body }) => service.updateMyProfile(actor, body),
  }),
  defineRoute({
    method: "put",
    path: "/me/avatar",
    operationId: "replaceMyAvatar",
    summary: "Upload a new profile picture (PNG/JPEG/GIF/WebP, max 5 MB)",
    tags,
    middleware: [singleFile(5 * MB)],
    upload: { description: "Image file, max 5 MB" },
    response: { status: 200, schema: meSchema },
    handler: ({ actor, req }) => service.replaceAvatar(actor, req.file),
  }),
  defineRoute({
    method: "get",
    path: "/me/private",
    operationId: "getMyPrivateProfile",
    summary: "Your private HR details",
    tags,
    response: { status: 200, schema: privateSchema },
    handler: ({ actor }) => service.getMyPrivate(actor),
  }),
  defineRoute({
    method: "patch",
    path: "/me/private",
    operationId: "updateMyPrivateProfile",
    summary: "Edit your private HR details",
    tags,
    request: {
      body: z
        .object({
          mobile: z.string().trim().max(40).nullish(),
          employeeNumber: z.string().trim().max(40).nullish(),
          employmentStatus: z.enum(EMPLOYMENT_STATUSES).nullish(),
        })
        .meta({ id: "UpdatePrivateProfileRequest" }),
    },
    response: { status: 200, schema: privateSchema },
    handler: ({ actor, body }) => service.updateMyPrivate(actor, body),
  }),
  defineRoute({
    method: "get",
    path: "/me/time-off",
    operationId: "listMyTimeOff",
    summary: "Your time off entries",
    tags,
    response: { status: 200, schema: z.array(timeOffSchema) },
    handler: ({ actor }) => service.listMyTimeOff(actor),
  }),
  defineRoute({
    method: "post",
    path: "/me/time-off",
    operationId: "addMyTimeOff",
    summary: "Record time off",
    tags,
    request: {
      body: z
        .object({
          kind: z.enum(TIME_OFF_KINDS),
          startDate: isoDate,
          endDate: isoDate,
          note: z.string().trim().max(500).nullish(),
        })
        .refine((value) => value.endDate >= value.startDate, {
          path: ["endDate"],
          message: "End date must be on or after the start date",
        })
        .meta({ id: "AddTimeOffRequest" }),
    },
    response: { status: 201, schema: timeOffSchema },
    handler: ({ actor, body }) => service.addMyTimeOff(actor, body),
  }),
  defineRoute({
    method: "delete",
    path: "/me/time-off/:timeOffId",
    operationId: "deleteMyTimeOff",
    summary: "Remove one of your time off entries",
    tags,
    request: { params: z.object({ timeOffId: z.uuid() }) },
    response: { status: 204 },
    errors: [404],
    handler: ({ actor, params }) => service.deleteMyTimeOff(actor, params.timeOffId),
  }),
];
