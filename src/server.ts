import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDatabase } from "./database/client.js";
import { ensureBucket } from "./integrations/storage/object-storage.js";
import { accessEvents } from "./modules/access/access-events.js";
import { startMaintenance } from "./modules/maintenance/maintenance.service.js";
import { logger } from "./shared/observability/logger.js";

const server = createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "API listening");
});
const stopMaintenance = startMaintenance();

// Local storage (RustFS/MinIO) starts empty; production buckets are provisioned with the infrastructure.
if (env.NODE_ENV !== "production") {
  ensureBucket().catch((error: unknown) =>
    logger.warn({ err: error, bucket: env.S3_BUCKET }, "could not create the storage bucket"),
  );
}

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  stopMaintenance();
  server.closeAllConnections();
  server.close(() => {
    Promise.all([accessEvents.close(), closeDatabase()])
      .catch((error: unknown) => logger.error({ err: error }, "database close failed"))
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
