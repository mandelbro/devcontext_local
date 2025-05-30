// __tests__/job.service.test.js
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { BackgroundJobManager } from "../src/services/job.service.js";
import * as dbQueries from "../src/db/queries.js";
import {
  createMockDbClient,
  createMockAIService,
  createMockConfig,
} from "../test/utils/test-helpers.js";

// Mock external modules
vi.mock("../src/db/client.js", () => ({
  default: vi.fn(() => createMockDbClient()),
}));

vi.mock("../src/db/queries.js", () => ({
  fetchPendingAiJobs: vi.fn(),
  updateAiJobStatusAndAttempts: vi.fn(),
  // Add other query functions as needed
}));

vi.mock("../src/config.js", () => createMockConfig());

vi.mock("../src/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("BackgroundJobManager", () => {
  let jobManager;
  let mockAIService;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock AIService
    mockAIService = createMockAIService();

    // Create job manager for testing
    jobManager = new BackgroundJobManager({
      aiService: mockAIService,
    });
  });

  afterEach(() => {
    // Clean up any intervals that might have been set
    if (jobManager.intervalId) {
      clearInterval(jobManager.intervalId);
    }
  });

  test("initializes with default configuration", async () => {
    // Initialize the manager
    await jobManager.initialize();

    // Verify initial state
    expect(jobManager.initialized).toBe(true);
    expect(jobManager.isRunning).toBe(false);
    expect(jobManager.pollingInterval).toBe(5000); // Default value
    expect(jobManager.concurrency).toBe(1); // Default value
    expect(jobManager.activeJobsCount).toBe(0);
  });

  test("initializes with custom configuration from config", async () => {
    // Mock config values
    const mockConfig = createMockConfig({
      AI_JOB_CONCURRENCY: 3,
      AI_JOB_DELAY_MS: 2000,
      MAX_AI_JOB_ATTEMPTS: 5,
    });

    // Apply mock config to the job manager
    jobManager.configService = mockConfig;

    // Initialize and start with options
    await jobManager.initialize();
    jobManager.start();

    // Verify configuration was applied
    expect(jobManager.concurrency).toBe(3);
    expect(jobManager.jobDelayMs).toBe(2000);
    expect(jobManager.maxAiJobAttempts).toBe(5);
    expect(jobManager.isRunning).toBe(true);

    // Clean up
    jobManager.stop();
  });

  test("starts and stops job processing", async () => {
    await jobManager.initialize();

    // Start the job manager
    jobManager.start({
      pollingInterval: 1000,
      concurrency: 2,
      batchSize: 10,
    });

    // Verify it's running with correct settings
    expect(jobManager.isRunning).toBe(true);
    expect(jobManager.pollingInterval).toBe(1000);
    expect(jobManager.concurrency).toBe(2);
    expect(jobManager.batchSize).toBe(10);
    expect(jobManager.intervalId).toBeTruthy();

    // Stop the job manager
    jobManager.stop();

    // Verify it's stopped
    expect(jobManager.isRunning).toBe(false);
    expect(jobManager.intervalId).toBeNull();
  });

  test("does not start if already running", async () => {
    await jobManager.initialize();

    // Start the first time
    jobManager.start();
    const firstIntervalId = jobManager.intervalId;

    // Try to start again
    jobManager.start();

    // Verify the interval hasn't changed
    expect(jobManager.intervalId).toBe(firstIntervalId);

    // Clean up
    jobManager.stop();
  });

  test("setAIService updates the AIService instance", () => {
    const newMockAIService = createMockAIService();

    // Set the new service
    jobManager.setAIService(newMockAIService);

    // Verify it was updated
    expect(jobManager.aiService).toBe(newMockAIService);
  });
});
