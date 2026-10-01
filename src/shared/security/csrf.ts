import type { RequestHandler } from "express";
import { ForbiddenError } from "../http/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookie-authenticated state changes must come from an allowed browser origin.
 * Requests without cookies (webhooks, OAuth bearer clients) are not CSRF-exposed and pass through.
 */
export function requireTrustedOrigin(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method) || !req.headers.cookie) return next();
    const source = req.header("origin") ?? req.header("referer");
    let origin: string | undefined;
    try {
      origin = source ? new URL(source).origin : undefined;
    } catch {
      origin = undefined;
    }
    if (!origin || !allowed.has(origin))
      return next(new ForbiddenError("Request origin is not allowed", "CSRF_REJECTED"));
    next();
  };
}
