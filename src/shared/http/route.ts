import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import type { ZodOpenApiOperationObject, ZodOpenApiPathsObject } from "zod-openapi";
import type { Actor } from "../../modules/access/access.types.js";
import { UnauthorizedError } from "./errors.js";
import { errorResponseSchema, paginatedEnvelope, successEnvelope } from "./openapi-schemas.js";
import { parseBody, parseParams, parseQuery } from "./validate.js";

type Method = "get" | "post" | "put" | "patch" | "delete";
type AnyObject = z.ZodObject<z.ZodRawShape>;

type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;

type RouteContext<P, Q, B, A extends boolean> = {
  req: Request;
  res: Response;
  params: Infer<P>;
  query: Infer<Q>;
  body: Infer<B>;
  actor: A extends true ? Actor : Actor | undefined;
};

type ResponseSpec =
  | { status: 200 | 201; schema: z.ZodType; paginated?: false }
  | { status: 200; schema: z.ZodType; paginated: true }
  | { status: 200; eventStream: string }
  | { status: 204 };

export type RouteDefinition<P = unknown, Q = unknown, B = unknown, A extends boolean = true> = {
  method: Method;
  /** Express-style path relative to /api/v1, e.g. "/projects/:projectId". */
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  /** true = signed-in actor required (default); false = public. */
  auth?: A;
  request?: { params?: P; query?: Q; body?: B };
  response: ResponseSpec;
  /** Documented error statuses besides 400 (validation) and 500. */
  errors?: number[];
  middleware?: RequestHandler[];
  /** Documents a multipart/form-data body with one binary `file` field (parsed by `middleware`). */
  upload?: { description: string };
  handler: (ctx: RouteContext<P, Q, B, A>) => Promise<unknown>;
};

// Erased form stored in module route lists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRoute = RouteDefinition<any, any, any, any>;

/** Identity helper that keeps full type inference for params/query/body in handlers. */
export function defineRoute<
  P extends AnyObject | undefined = undefined,
  Q extends AnyObject | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
  A extends boolean = true,
>(route: RouteDefinition<P, Q, B, A>): RouteDefinition<P, Q, B, A> {
  return route;
}

export function mountRoutes(router: Router, routes: AnyRoute[]): void {
  for (const route of routes) {
    const handler = async (req: Request, res: Response, next: NextFunction) => {
      try {
        const requiresActor = route.auth !== false;
        if (requiresActor && !req.actor) throw new UnauthorizedError();
        const params = route.request?.params ? parseParams(req, route.request.params) : undefined;
        const query = route.request?.query ? parseQuery(req, route.request.query) : undefined;
        const body = route.request?.body ? parseBody(req, route.request.body) : undefined;
        const result = await route.handler({ req, res, params, query, body, actor: req.actor });
        if (res.headersSent) return;
        const spec = route.response;
        if (spec.status === 204) res.status(204).end();
        else if ("eventStream" in spec) return;
        else if (spec.paginated) {
          const page = result as { items: unknown[]; nextCursor?: string | null; total?: number };
          res.paginated(page.items, {
            nextCursor: page.nextCursor ?? null,
            ...(page.total !== undefined ? { total: page.total } : {}),
          });
        } else res.ok(result, spec.status);
      } catch (error) {
        next(error);
      }
    };
    // Tags the response with the documented operation, so recorders and logs see the pattern
    // (e.g. /api/v1/tickets/:ticketId) even when a later middleware or error handler responds.
    const tag: RequestHandler = (req, res, next) => {
      res.locals.operation = {
        method: route.method.toUpperCase(),
        path: `${req.baseUrl}${route.path}`,
      };
      next();
    };
    router[route.method](route.path, tag, ...(route.middleware ?? []), handler);
  }
}

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "Validation failed",
  401: "Not signed in",
  403: "Not allowed",
  404: "Not found",
  409: "Conflict with current state",
  429: "Rate limited",
  502: "Upstream service failed",
};

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export function routesToOpenApiPaths(
  routes: AnyRoute[],
  prefix = "/api/v1",
): ZodOpenApiPathsObject {
  const paths: ZodOpenApiPathsObject = {};
  for (const route of routes) {
    const spec = route.response;
    const success =
      spec.status === 204
        ? { description: "No content" }
        : "eventStream" in spec
          ? {
              description: spec.eventStream,
              content: { "text/event-stream": { schema: z.string() } },
            }
          : {
              description: "Success",
              content: {
                "application/json": {
                  schema: spec.paginated
                    ? paginatedEnvelope(spec.schema)
                    : successEnvelope(spec.schema),
                },
              },
            };
    const errorStatuses = new Set([
      400,
      500,
      ...(route.errors ?? []),
      ...(route.auth === false ? [] : [401]),
    ]);
    const responses: Record<string, unknown> = { [String(spec.status)]: success };
    for (const status of [...errorStatuses].sort()) {
      responses[String(status)] = {
        description: ERROR_DESCRIPTIONS[status] ?? "Unexpected error",
        content: { "application/json": { schema: errorResponseSchema } },
      };
    }
    const operation: ZodOpenApiOperationObject = {
      operationId: route.operationId,
      summary: route.summary,
      tags: route.tags,
      security: route.auth === false ? [] : [{ sessionCookie: [] }],
      requestParams: {
        ...(route.request?.params ? { path: route.request.params } : {}),
        ...(route.request?.query ? { query: route.request.query } : {}),
      },
      ...(route.request?.body
        ? { requestBody: { content: { "application/json": { schema: route.request.body } } } }
        : {}),
      ...(route.upload
        ? {
            requestBody: {
              description: route.upload.description,
              content: {
                "multipart/form-data": {
                  schema: z.object({ file: z.string().meta({ format: "binary" }) }),
                },
              },
            },
          }
        : {}),
      responses: responses as ZodOpenApiOperationObject["responses"],
    };
    const key = `${prefix}${toOpenApiPath(route.path)}`;
    paths[key] = { ...(paths[key] ?? {}), [route.method]: operation };
  }
  return paths;
}
