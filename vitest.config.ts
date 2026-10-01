import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/support/global-setup.ts"],
    setupFiles: ["./tests/support/setup-env.ts"],
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // One database: run test files sequentially so per-test truncation stays isolated.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
