import { beforeAll, inject } from "vitest";
import { testEnv } from "./global-setup.js";

Object.assign(process.env, testEnv(inject("databaseUrl"), inject("storageEndpoint")));

beforeAll(async () => {
  const { ensureBucket } = await import("../../src/integrations/storage/object-storage.js");
  await ensureBucket();
});
