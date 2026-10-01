import type { RequestHandler, Response } from "express";

export type PageMeta = { nextCursor?: string | null; total?: number };

declare module "express-serve-static-core" {
  interface Response {
    /** Sends `{ data, meta }` with the request ID. */
    ok(data: unknown, status?: number): void;
    /** Sends `{ data: items, meta: { requestId, nextCursor, total } }`. */
    paginated(items: unknown[], page: PageMeta): void;
  }
}

function meta(res: Response, extra: object = {}) {
  return { requestId: res.req.id, ...extra };
}

/** Installs the standard success envelope helpers; route handlers never call res.json directly. */
export const responseHelpers: RequestHandler = (_req, res, next) => {
  res.ok = (data, status = 200) => {
    res.status(status).json({ data, meta: meta(res) });
  };
  res.paginated = (items, page) => {
    res.status(200).json({ data: items, meta: meta(res, page) });
  };
  next();
};
