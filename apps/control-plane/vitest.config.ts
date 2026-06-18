import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // env.ts captures APP_SECRET at import time; set it before modules evaluate so
    // the crypto util has a key under test (mirrors a real deploy's APP_SECRET).
    env: {
      APP_SECRET: "test-app-secret-at-least-32-characters-long",
      PUBLIC_BASE_URL: "https://radio.example.com",
    },
  },
});
