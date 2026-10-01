import { execFileSync } from "node:child_process";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import type { TestProject } from "vitest/node";

let container: StartedPostgreSqlContainer | undefined;
let storage: StartedTestContainer | undefined;
let storageEndpoint = "";

/** Starts an isolated PostgreSQL, builds the schema from zero with every migration, shares the URL. */
export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("aero_zenith_flow_test")
    .withUsername("azf")
    .withPassword("azf_test_password")
    .start();
  storage = await new GenericContainer("rustfs/rustfs:latest")
    .withEnvironment({
      RUSTFS_ACCESS_KEY: "test_storage",
      RUSTFS_SECRET_KEY: "test_storage_secret",
    })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  storageEndpoint = `http://${storage.getHost()}:${storage.getMappedPort(9000)}`;
  const databaseUrl = container.getConnectionUri();
  if (!new URL(databaseUrl).pathname.endsWith("_test"))
    throw new Error("Refusing to migrate a non-test database");
  execFileSync("npx", ["tsx", "src/database/migrate.ts"], {
    env: { ...process.env, ...testEnv(databaseUrl) },
    stdio: "inherit",
  });
  project.provide("databaseUrl", databaseUrl);
  project.provide("storageEndpoint", storageEndpoint);
}

export async function teardown() {
  await Promise.all([container?.stop(), storage?.stop()]);
}

export function testEnv(databaseUrl: string, s3Endpoint = storageEndpoint): Record<string, string> {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: databaseUrl,
    APP_URL: "http://app.test",
    // HTTPS: the MCP resource identifier (API_URL/mcp) must be HTTPS unless it is loopback.
    API_URL: "https://api.test",
    AUTH_SECRET: "test-only-auth-secret-0123456789abcdefghijklmnop",
    SMTP_URL: "memory://",
    EMAIL_FROM: "Space Scope <noreply@test.local>",
    S3_ENDPOINT: s3Endpoint,
    S3_BUCKET: "aero-zenith-flow-test",
    S3_ACCESS_KEY_ID: "test_storage",
    S3_SECRET_ACCESS_KEY: "test_storage_secret",
    S3_FORCE_PATH_STYLE: "true",
    JIRA_CLIENT_ID: "test-jira-client-id",
    JIRA_CLIENT_SECRET: "test-jira-client-secret",
    JIRA_REDIRECT_URI: "http://api.test/api/v1/jira/oauth/callback",
    JIRA_TOKEN_ENCRYPTION_KEY: "test-only-jira-token-encryption-key-0123456789",
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    storageEndpoint: string;
  }
}
