import type { Request } from "express";
import type { z } from "zod";
import { ValidationError } from "./errors.js";

function parseWith<T extends z.ZodType>(schema: T, value: unknown, location: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ValidationError(
    "The request is invalid",
    result.error.issues.map((issue) => ({
      path: [location, ...issue.path.map(String)].join("."),
      message: issue.message,
    })),
  );
}

export const parseBody = <T extends z.ZodType>(req: Request, schema: T) =>
  parseWith(schema, req.body, "body");
export const parseQuery = <T extends z.ZodType>(req: Request, schema: T) =>
  parseWith(schema, req.query, "query");
export const parseParams = <T extends z.ZodType>(req: Request, schema: T) =>
  parseWith(schema, req.params, "params");
