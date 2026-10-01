import { appendFileSync } from "node:fs";
import type { RequestHandler } from "express";

/**
 * Test-only recorder: appends `{ method, path, status }` for every response that matched a
 * documented operation (tagged by mountRoutes). Enabled by API_COVERAGE_FILE when NODE_ENV=test.
 */
export function apiCoverageRecorder(file: string): RequestHandler {
  return (_req, res, next) => {
    res.once("close", () => {
      const operation = res.locals.operation as { method: string; path: string } | undefined;
      if (!operation) return;
      appendFileSync(file, `${JSON.stringify({ ...operation, status: res.statusCode })}\n`);
    });
    next();
  };
}
