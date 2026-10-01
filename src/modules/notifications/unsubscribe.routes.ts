import express from "express";
import { z } from "zod";
import { NotFoundError } from "../../shared/http/errors.js";
import { defineRoute } from "../../shared/http/route.js";
import { emailFromToken, isSuppressedEmail, suppress } from "./unsubscribe.js";

const tags = ["email"];
const resultSchema = z
  .object({ valid: z.boolean(), alreadyUnsubscribed: z.boolean() })
  .meta({ id: "UnsubscribeStatus" });

function requireEmail(token?: string) {
  const email = token ? emailFromToken(token) : null;
  if (!email) throw new NotFoundError("Unsubscribe link", "UNSUBSCRIBE_TOKEN_INVALID");
  return email;
}

export const unsubscribeRoutes = [
  defineRoute({
    method: "get",
    path: "/email/unsubscribe",
    operationId: "checkUnsubscribe",
    summary: "Check an unsubscribe link (public)",
    tags,
    auth: false,
    request: { query: z.object({ token: z.string().max(600) }) },
    response: { status: 200, schema: resultSchema },
    errors: [404],
    handler: async ({ query }) => ({
      valid: true,
      alreadyUnsubscribed: await isSuppressedEmail(requireEmail(query.token)),
    }),
  }),
  defineRoute({
    method: "post",
    path: "/email/unsubscribe",
    operationId: "confirmUnsubscribe",
    summary: "Unsubscribe (public). Token in the query (RFC 8058 one-click) or JSON body.",
    tags,
    auth: false,
    middleware: [express.urlencoded({ extended: false, limit: "4kb" })],
    request: {
      query: z.object({ token: z.string().max(600).optional() }),
      body: z
        .object({ token: z.string().max(600).optional() })
        .passthrough()
        .optional(),
    },
    response: { status: 200, schema: resultSchema },
    errors: [404],
    handler: async ({ query, body }) => {
      const email = requireEmail(query.token ?? body?.token);
      const created = await suppress(email, "unsubscribe");
      return { valid: true, alreadyUnsubscribed: !created };
    },
  }),
];
