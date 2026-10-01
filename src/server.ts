import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDatabase } from "./database/client.js";
import { logger } from "./shared/observability/logger.js";

const server = createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "API listening");
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  server.close(() => {
    closeDatabase()
      .catch((error: unknown) => logger.error({ err: error }, "database close failed"))
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
