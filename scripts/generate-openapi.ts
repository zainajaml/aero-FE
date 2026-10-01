// Writes openapi/openapi.json from the route definitions. Placeholder config is enough:
// building the document never connects to the database or sends email.
import { mkdirSync, writeFileSync } from "node:fs";

Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://openapi:openapi@127.0.0.1:1/openapi",
  APP_URL: "http://localhost:5173",
  API_URL: "http://localhost:4000",
  AUTH_SECRET: "openapi-generation-only-secret-0123456789",
  SMTP_URL: "memory://",
  EMAIL_FROM: "Space Scope <noreply@localhost>",
});

const { buildOpenApiDocument } = await import("../src/openapi.js");
mkdirSync("openapi", { recursive: true });
writeFileSync("openapi/openapi.json", `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log("openapi/openapi.json written");
process.exit(0);
