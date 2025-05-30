/**
 * Jest Configuration for DevContext
 */

export default {
  // The root directory where Jest should scan for tests
  rootDir: ".",

  // The test environment that will be used for testing
  testEnvironment: "node",

  // Configure transformIgnorePatterns to not transform node_modules except for specific packages
  transformIgnorePatterns: [
    "/node_modules/(?!tree-sitter|node-fetch|fetch-blob|data-uri-to-buffer|formdata-polyfill)",
  ],

  // The glob patterns Jest uses to detect test files
  testMatch: ["**/test/**/*.test.js", "**/test/**/*.spec.js"],

  // Files to ignore
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],

  // Setup files that run before each test file
  setupFilesAfterEnv: ["<rootDir>/test/setup.js"],

  // Indicates whether each individual test should be reported during the run
  verbose: true,

  // Collect test coverage information
  collectCoverage: true,
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/mcp-handlers/**", // Exclude MCP handlers for now
    "!**/node_modules/**",
  ],
  coverageDirectory: "coverage",

  // Minimum coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },

  // Display individual test results with a character
  reporters: ["default"],

  // Transform files with babel
  transform: {
    "^.+\\.jsx?$": ["babel-jest", { rootMode: "upward" }],
  },

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverageFrom: [
    "src/**/*.{js,jsx}",
    "!**/node_modules/**",
    "!**/dist/**",
  ],

  // A map from regular expressions to module names that allow to stub out resources with a single module
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
