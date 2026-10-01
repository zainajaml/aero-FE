import { AppError, ConflictError, ValidationError } from "./errors.js";

type PgError = { code?: string; constraint?: string };

function pgErrorOf(error: unknown): PgError | undefined {
  let current: unknown = error;
  // Drizzle wraps driver errors; walk the cause chain to the pg error.
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as PgError & { cause?: unknown };
    if (typeof candidate.code === "string" && candidate.code.length === 5) return candidate;
    current = candidate.cause;
  }
  return undefined;
}

/** Translates known PostgreSQL failures into domain errors; returns undefined for anything else. */
export function translateDatabaseError(error: unknown): AppError | undefined {
  const pg = pgErrorOf(error);
  switch (pg?.code) {
    case "23505":
      return new ConflictError("This value is already in use", "DUPLICATE");
    case "23503":
      return new ConflictError(
        "A related record does not exist or is still in use",
        "REFERENCE_CONFLICT",
      );
    case "23514":
      return new ValidationError("A value is outside the allowed range");
    case "AZ001":
      return new ConflictError(
        "This project is archived. Restore it to make changes.",
        "PROJECT_ARCHIVED",
      );
    case "AZ002":
      return new ConflictError(
        "Account admins cannot hold project roles in an account they administer",
        "ACCOUNT_ADMIN_PROJECT_ROLE",
      );
    default:
      return undefined;
  }
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = pgErrorOf(error);
  return pg?.code === "23505" && (!constraint || pg.constraint === constraint);
}
