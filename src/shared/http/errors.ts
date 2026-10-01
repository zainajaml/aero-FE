export type ErrorDetail = { path?: string; message: string };

/** Base class for errors whose message is safe to show to API clients. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "The request is invalid", details: ErrorDetail[] = []) {
    super(400, "VALIDATION_FAILED", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in to continue") {
    super(401, "UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this", code = "FORBIDDEN") {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource", code = "NOT_FOUND") {
    super(404, code, `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT") {
    super(409, code, message);
  }
}

export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, options?: { cause?: unknown }) {
    super(
      502,
      "EXTERNAL_SERVICE_FAILED",
      `${service} is unavailable. Please try again.`,
      [],
      options,
    );
  }
}
