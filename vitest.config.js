// vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      reporter: ["text", "json", "html"],
    },
    include: ["**/__tests__/**/*.test.js", "**/test/**/*.test.js"],
    setupFiles: ["./test/setup.js"],
  },
});
