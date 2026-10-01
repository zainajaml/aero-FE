import { createDocument } from "zod-openapi";
import { apiRoutes } from "./routes.js";
import { routesToOpenApiPaths } from "./shared/http/route.js";

export function buildOpenApiDocument() {
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Aero Zenith Flow API",
      version: "1.0.0",
      description: [
        "Space Scope backend. JSON responses use `{ data, meta }`; errors use `{ error, meta }`.",
        "Authentication endpoints under `/api/auth/*` are served by Better Auth and follow its protocol.",
        "Health probes (`/health/live`, `/health/ready`) return a fixed `{ status }` shape.",
      ].join("\n\n"),
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "azf.session_token" },
      },
    },
    paths: routesToOpenApiPaths(apiRoutes),
  });
}
