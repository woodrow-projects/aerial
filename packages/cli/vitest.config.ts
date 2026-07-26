import { defineConfig } from "vitest/config";

/**
 * Unit-test harness for the aerial CLI (ADR D14 — TDD is mandatory).
 *
 * Tests live next to the code they cover as `*.spec.ts` and are pure: no real
 * provider APIs, no real ssh/docker/ssh-keygen processes, no network, no
 * filesystem outside temp dirs — collaborators (fetch, Shell, Prompter, config
 * store) are injected and mocked. The live per-provider e2e (real token, real
 * throwaway domain) is a separate scripted check, NOT part of this suite.
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
      // index.ts is wiring-only (arg routing + real-dependency construction).
      exclude: ["src/index.ts", "src/**/*.spec.ts"],
    },
  },
});
