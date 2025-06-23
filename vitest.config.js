// vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "coverage/**",
        "dist/**",
        "**/*.d.ts",
        "**/*.config.*",
        "**/*.test.*",
        "test/**",
        "__tests__/**",
        "node_modules/**",
        "**/test-helpers.js"
      ]
    },
    include: ["**/__tests__/**/*.test.js", "**/test/**/*.test.js"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.manual.test.js", // Exclude manual test files
      "**/connectionFactory.manual.test.js"
    ],
    setupFiles: ["./test/setup.js"],
  },
});
