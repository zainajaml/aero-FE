import { z } from "zod";
import "zod-openapi";

const metaSchema = z
  .object({ requestId: z.string() })
  .meta({ id: "ResponseMeta", description: "Present on every JSON response" });

const pageMetaSchema = z
  .object({
    requestId: z.string(),
    nextCursor: z
      .string()
      .nullable()
      .describe("Opaque cursor for the next page; null on the last page"),
    total: z.number().int().optional(),
  })
  .meta({ id: "PageMeta" });

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().describe("Stable machine-readable code, e.g. PROJECT_ARCHIVED"),
      message: z.string().describe("Safe, user-facing message"),
      details: z.array(z.object({ path: z.string().optional(), message: z.string() })),
    }),
    meta: metaSchema,
  })
  .meta({ id: "ErrorResponse" });

export function successEnvelope(data: z.ZodType) {
  return z.object({ data, meta: metaSchema });
}

export function paginatedEnvelope(item: z.ZodType) {
  return z.object({ data: z.array(item), meta: pageMetaSchema });
}
