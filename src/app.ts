import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { toNodeHandler } from "better-auth/node";
import { env } from "./config/env.js";
import { auth } from "./modules/auth/auth.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { buildOpenApiDocument } from "./openapi.js";
import { apiRoutes } from "./routes.js";
import { errorHandler, notFoundHandler } from "./shared/http/error-handler.js";
import { requestId } from "./shared/http/request-context.js";
import { responseHelpers } from "./shared/http/respond.js";
import { mountRoutes } from "./shared/http/route.js";
import { logger } from "./shared/observability/logger.js";
import { authenticate } from "./shared/security/authenticate.js";
import { requireTrustedOrigin } from "./shared/security/csrf.js";
import { LIMITS, rateLimitByRequest } from "./shared/security/rate-limit.js";

export function createApp() {
  const app = express();
  const allowedOrigins = [env.APP_URL, ...env.CORS_ORIGINS];

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: env.NODE_ENV !== "test",
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
      exposedHeaders: ["X-Request-Id", "Retry-After"],
    }),
  );
  app.use(responseHelpers);

  app.use("/health", healthRouter);

  // Better Auth parses its own bodies, so it is mounted before express.json().
  app.post("/api/auth/sign-in/*splat", rateLimitByRequest("auth:sign-in", LIMITS.authSignIn));
  app.post("/api/auth/sign-up/*splat", rateLimitByRequest("auth:sign-up", LIMITS.authSignUp));
  app.post(
    ["/api/auth/request-password-reset", "/api/auth/send-verification-email"],
    rateLimitByRequest("auth:email-action", LIMITS.authEmailAction),
  );
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json({ limit: "1mb" }));

  const api = Router();
  api.use(requireTrustedOrigin(allowedOrigins));
  api.use(authenticate);
  mountRoutes(api, apiRoutes);
  app.use("/api/v1", api);

  if (env.NODE_ENV !== "production") {
    const document = buildOpenApiDocument();
    app.get("/api/openapi.json", (_req, res) => {
      res.json(document);
    });
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(document));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
