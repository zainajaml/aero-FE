import type { ErrorRequestHandler, RequestHandler } from "express";
import { logger } from "../observability/logger.js";
import { translateDatabaseError } from "./database-errors.js";
import { AppError, NotFoundError, RateLimitedError, ValidationError } from "./errors.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`, "ROUTE_NOT_FOUND"));
};

function toAppError(error: unknown): AppError | undefined {
  if (error instanceof AppError) return error;
  const translated = translateDatabaseError(error);
  if (translated) return translated;
  const http = error as { type?: string; status?: number };
  if (http.type === "entity.parse.failed") return new ValidationError("Malformed JSON body");
  if (http.type === "entity.too.large") return new ValidationError("Request body is too large");
  return undefined;
}

/** The single place where errors become HTTP responses. */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const appError = toAppError(error);
  const requestId = req.id;

  if (appError) {
    if (appError.status >= 500) logger.error({ err: error, requestId }, appError.message);
    else logger.debug({ code: appError.code, requestId }, appError.message);
    if (appError instanceof RateLimitedError)
      res.setHeader("Retry-After", String(appError.retryAfterSeconds));
    res.status(appError.status).json({
      error: { code: appError.code, message: appError.message, details: appError.details },
      meta: { requestId },
    });
    return;
  }

  logger.error({ err: error, requestId }, "Unhandled error");
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
      details: [],
    },
    meta: { requestId },
  });
};
