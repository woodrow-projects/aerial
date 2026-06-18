import { defineConfig } from "vitest/config";

/**
 * Unit-test harness for the control plane (ADR D14 — TDD is mandatory).
 *
 * Tests live next to the code they cover as `*.spec.ts`. They are pure unit
 * tests: no real Postgres, no real Liquidsoap, no network — collaborators are
 * mocked. Integration/e2e suites (real engine via docker compose) are tracked
 * separately and are NOT run here.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      // Wiring-only files carry no logic worth a unit test.
      exclude: ["src/**/*.module.ts", "src/main.ts", "src/**/*.spec.ts"],
    },
  },
});
