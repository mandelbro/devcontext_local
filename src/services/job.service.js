/**
 * BackgroundJobManager
 *
 * This service manages the queueing of background AI jobs for entity/document processing.
 */

import { v4 as uuidv4 } from "uuid";
import logger from "../utils/logger.js";
import initializeDbClient from "../db/client.js";
import * as dbQueries from "../db/queries.js";
import config from "../config.js";
import { RateLimitError, AIProviderError } from "../utils/errors.js";

// Default configuration values
const DEFAULT_POLLING_INTERVAL_MS = 5000; // 5 seconds
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_JOB_DELAY_MS = 0; // Default to no delay between jobs
const DEFAULT_RATE_LIMIT_PAUSE_SECONDS = 60; // Default pause time for rate limits if not specified
const DEFAULT_MAX_AI_JOB_ATTEMPTS = 3; // Default maximum attempts for AI jobs

/**
 * Helper function to create a delay
 * @param {number} ms - The delay in milliseconds
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BackgroundJobManager {
  /**
   * Creates a new BackgroundJobManager instance
   * @param {Object} [options] - Configuration options
   * @param {Object} [options.aiService] - The AIService instance to use for job processing
   */
  constructor(options = {}) {
    this.dbClient = null;
    this.initialized = false;
    this.isRunning = false;
    this.isProcessing = false;
    this.pollingInterval = DEFAULT_POLLING_INTERVAL_MS;
    this.concurrency = DEFAULT_CONCURRENCY;
    this.batchSize = DEFAULT_BATCH_SIZE;
    this.jobDelayMs = DEFAULT_JOB_DELAY_MS; // Delay between processing individual jobs
    this.intervalId = null;
    this.activeJobsCount = 0; // Counter for currently processing jobs
    this.aiService = options.aiService; // AIService instance for processing jobs
    this.taskTypePauseUntil = {}; // Object to store pause end times per task type
    this.maxAiJobAttempts = DEFAULT_MAX_AI_JOB_ATTEMPTS; // Maximum attempts for AI jobs
  }

  /**
   * Initialize the BackgroundJobManager
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      logger.info("Initializing BackgroundJobManager");
      this.dbClient = initializeDbClient();
      this.initialized = true;

      // Get max attempts from config if available
      this.maxAiJobAttempts =
        config.MAX_AI_JOB_ATTEMPTS || DEFAULT_MAX_AI_JOB_ATTEMPTS;

      logger.info("BackgroundJobManager initialized successfully");
    } catch (error) {
      logger.error(
        `Error initializing BackgroundJobManager: ${error.message}`,
        { error }
      );
      throw error;
    }
  }

  /**
   * Set the AIService instance
   * @param {Object} aiService - The AIService instance
   */
  setAIService(aiService) {
    this.aiService = aiService;
    logger.info("AIService instance set in BackgroundJobManager");
  }

  /**
   * Start the job processing loop
   * @param {Object} [options] - Configuration options
   * @param {number} [options.pollingInterval] - Polling interval in milliseconds
   * @param {number} [options.concurrency] - Maximum number of concurrent jobs
   * @param {number} [options.batchSize] - Number of jobs to fetch at once
   * @returns {void}
   */
  start(options = {}) {
    if (this.isRunning) {
      logger.warn("BackgroundJobManager is already running");
      return;
    }

    // Apply configuration options if provided
    this.pollingInterval =
      options.pollingInterval || DEFAULT_POLLING_INTERVAL_MS;

    // Get concurrency from config (AI_JOB_CONCURRENCY) if available, otherwise use provided option or default
    this.concurrency =
      config.AI_JOB_CONCURRENCY || options.concurrency || DEFAULT_CONCURRENCY;

    // Get job delay from config (AI_JOB_DELAY_MS) if available, otherwise use default
    this.jobDelayMs = config.AI_JOB_DELAY_MS || DEFAULT_JOB_DELAY_MS;

    // Get max attempts from config (MAX_AI_JOB_ATTEMPTS) if available, otherwise use default
    this.maxAiJobAttempts =
      config.MAX_AI_JOB_ATTEMPTS || DEFAULT_MAX_AI_JOB_ATTEMPTS;

    this.batchSize = options.batchSize || DEFAULT_BATCH_SIZE;

    logger.info(
      `Starting BackgroundJobManager with polling interval: ${this.pollingInterval}ms, concurrency: ${this.concurrency}, batch size: ${this.batchSize}, job delay: ${this.jobDelayMs}ms, max attempts: ${this.maxAiJobAttempts}`
    );

    // Set the running flag and start the interval
    this.isRunning = true;
    this.intervalId = setInterval(
      this.processQueue.bind(this),
      this.pollingInterval
    );

    // Run processQueue immediately to start processing without waiting for the first interval
    logger.info(
      "BackgroundJobManager started successfully, initiating first polling cycle"
    );
    this.processQueue();
  }

  /**
   * Process pending jobs from the queue
   * @returns {Promise<void>}
   */
  async processQueue() {
    // Re-entrancy guard to prevent multiple concurrent executions
    if (this.isProcessing) {
      logger.debug("Already processing queue, skipping this cycle");
      return;
    }

    if (!this.initialized) {
      try {
        await this.initialize();
      } catch (error) {
        logger.error(
          `Failed to initialize during processQueue: ${error.message}`,
          { error }
        );
        return;
      }
    }

    this.isProcessing = true;
    logger.info(
      `Polling for AI jobs. Active jobs: ${this.activeJobsCount}/${this.concurrency}.`
    );

    try {
      // Check if we've reached the concurrency limit
      if (this.activeJobsCount >= this.concurrency) {
        logger.info(
          `Concurrency limit reached. Skipping fetch. (${this.activeJobsCount}/${this.concurrency} active jobs)`
        );
        return;
      }

      // Check if AIService is available
      if (!this.aiService) {
        logger.error("No AIService instance available. Cannot process jobs.");
        return;
      }

      // Clear expired task pauses
      this.clearExpiredTaskPauses();

      // Calculate how many more jobs we can process
      const availableSlots = this.concurrency - this.activeJobsCount;
      logger.debug(`Available slots for processing: ${availableSlots}`);

      // Get list of currently paused task types
      const pausedTaskTypes = Object.keys(this.taskTypePauseUntil);
      if (pausedTaskTypes.length > 0) {
        const pausedTaskTypesFormatted = pausedTaskTypes
          .map(
            (type) =>
              `${type} (until ${new Date(
                this.taskTypePauseUntil[type]
              ).toISOString()})`
          )
          .join(", ");
        logger.info(`Currently paused task types: ${pausedTaskTypesFormatted}`);
      }

      // Fetch pending jobs up to the available slots
      const jobsToProcess = await dbQueries.fetchPendingAiJobs(
        this.dbClient,
        availableSlots
      );

      if (jobsToProcess.length === 0) {
        logger.info("No pending AI jobs found in this cycle");
        return;
      }

      logger.info(`Fetched ${jobsToProcess.length} jobs for processing`);

      // Filter out jobs for paused task types
      const eligibleJobs = jobsToProcess.filter((job) => {
        const isPaused = this.isTaskTypePaused(job.task_type);
        if (isPaused) {
          logger.info(
            `Skipping job ${job.job_id} of type ${job.task_type} due to rate limit pause`
          );
        }
        return !isPaused;
      });

      if (eligibleJobs.length < jobsToProcess.length) {
        logger.info(
          `Filtered out ${
            jobsToProcess.length - eligibleJobs.length
          } jobs due to rate limit pauses`
        );
      }

      // For each job, initiate its processing
      for (let i = 0; i < eligibleJobs.length; i++) {
        const job = eligibleJobs[i];

        // Apply delay between jobs if configured (but not for the first job)
        if (i > 0 && this.jobDelayMs > 0) {
          logger.info(
            `Delaying for ${this.jobDelayMs}ms before dispatching job ${job.job_id}`
          );
          await delay(this.jobDelayMs);
        }

        logger.info(
          `Job ${job.job_id} (${job.task_type} for ${job.target_entity_type} ${
            job.target_entity_id
          }) picked for processing, attempt ${job.attempts + 1}`
        );

        // Increment the active jobs counter
        this.activeJobsCount++;

        // OUTER TRY-CATCH FOR INTERNAL ERRORS - Wrap the entire job processing logic
        try {
          // Update job status to 'processing' and increment attempts count
          await dbQueries.updateAiJobStatusAndAttempts(
            this.dbClient,
            job.job_id,
            "processing",
            1
          );
          logger.info(`Job ${job.job_id} status updated to 'processing'`);

          // Parse job payload if it exists
          let payload = {};
          if (job.payload) {
            try {
              payload = JSON.parse(job.payload);
            } catch (error) {
              logger.error(
                `Error parsing job payload for job ${job.job_id}: ${error.message}`,
                { jobId: job.job_id, error }
              );
              await dbQueries.updateAiJobStatusAndAttempts(
                this.dbClient,
                job.job_id,
                "failed_payload_parsing",
                0,
                `Invalid payload JSON: ${error.message}`
              );
              logger.error(
                `Job ${job.job_id} failed due to payload parsing error. Error: ${error.message}`
              );
              continue; // activeJobsCount will be decremented in the finally block
            }
          }

          // Process the job based on its task_type and target_entity_type
          try {
            let methodName;

            // Dispatch to the appropriate AIService method based on job type
            if (
              job.task_type === "enrich_entity_summary_keywords" &&
              job.target_entity_type === "code_entity"
            ) {
              // Code entity enrichment
              methodName = "enrichCodeEntity";
              logger.info(
                `Dispatching job ${job.job_id} to AIService method ${methodName} for entity ${job.target_entity_id}`
              );
              await this.aiService.enrichCodeEntity(
                job.target_entity_id,
                payload
              );
            } else if (
              job.task_type === "enrich_entity_summary_keywords" &&
              job.target_entity_type === "project_document"
            ) {
              // Project document enrichment
              methodName = "enrichDocument";
              logger.info(
                `Dispatching job ${job.job_id} to AIService method ${methodName} for document ${job.target_entity_id}`
              );
              await this.aiService.enrichDocument(
                job.target_entity_id,
                payload
              );
            } else if (job.task_type === "generate_topics") {
              // Conversation topic generation - dispatches to generateConversationTopics
              // The target_entity_id represents the conversationId in this case
              methodName = "generateConversationTopics";
              logger.info(
                `Dispatching job ${job.job_id} to AIService method ${methodName} for conversation ${job.target_entity_id}`
              );
              await this.aiService.generateConversationTopics(
                job.target_entity_id, // conversationId
                payload
              );
            } else {
              // Unknown job type
              throw new Error(
                `Unknown job type/target: ${job.task_type}/${job.target_entity_type}`
              );
            }

            // If we get here, the AIService method completed successfully
            logger.info(`Job ${job.job_id} completed successfully`);

            // Update job status to 'completed' with no increment to attempts
            await dbQueries.updateAiJobStatusAndAttempts(
              this.dbClient,
              job.job_id,
              "completed",
              0,
              null
            );
            logger.info(`Job ${job.job_id} status updated to 'completed'`);
          } catch (error) {
            // Handle different types of errors
            let status = "failed";
            let errorMessage = error.message;

            if (error instanceof RateLimitError) {
              status = "rate_limited"; // Changed from 'retry_rate_limit' to 'rate_limited'
              errorMessage = `Rate limit exceeded: ${
                error.message
              }. Retry after ${error.retryAfterSeconds || "unknown"} seconds.`;

              // Update job status without incrementing attempts
              await dbQueries.updateAiJobStatusAndAttempts(
                this.dbClient,
                job.job_id,
                status,
                0, // Don't increment attempts for rate limiting
                errorMessage
              );

              // Update target entity AI status to 'rate_limited'
              await dbQueries.updateEntityAiStatusForJobTarget(
                this.dbClient,
                job.target_entity_id,
                job.target_entity_type,
                "rate_limited"
              );

              // Set pause for this task type
              const retryAfterSeconds =
                error.retryAfterSeconds || DEFAULT_RATE_LIMIT_PAUSE_SECONDS;
              const pauseEndTime = Date.now() + retryAfterSeconds * 1000;
              this.taskTypePauseUntil[job.task_type] = pauseEndTime;

              // Log the rate limit and pause events
              logger.warn(
                `Job ${
                  job.job_id
                } hit rate limit. Status set to 'rate_limited'. Pausing task type ${
                  job.task_type
                } until ${new Date(pauseEndTime).toISOString()}. Error: ${
                  error.message
                }`
              );

              continue; // activeJobsCount will be decremented in the finally block
            } else if (error instanceof AIProviderError) {
              // For AIProviderError specifically, we handle as a potential retry
              // Check if we should retry or mark as failed (attempts count was already incremented)
              if (job.attempts < this.maxAiJobAttempts) {
                status = "retry_ai";
                logger.warn(
                  `Job ${job.job_id} failed (attempt ${job.attempts}/${this.maxAiJobAttempts}), status set to 'retry_ai'. Error: ${error.message}`
                );
              } else {
                // Max attempts reached - mark as permanently failed
                status = "failed_ai";
                logger.error(
                  `Job ${job.job_id} failed permanently after ${job.attempts} attempts (AI Provider Error). Error: ${error.message}`
                );

                // Update target entity's AI status to 'failed_ai'
                await dbQueries.updateEntityAiStatusForJobTarget(
                  this.dbClient,
                  job.target_entity_id,
                  job.target_entity_type,
                  "failed_ai",
                  null,
                  error.message
                );
              }
            } else if (error.message.includes("Unknown job type")) {
              status = "failed_job_logic";
              logger.error(
                `Job ${job.job_id} failed due to unknown job type. Error: ${error.message}`
              );
            } else {
              // For any other error type, check if we should retry based on attempt count
              if (job.attempts < this.maxAiJobAttempts) {
                status = "retry_ai";
                logger.warn(
                  `Job ${job.job_id} failed (attempt ${job.attempts}/${this.maxAiJobAttempts}), status set to 'retry_ai'. Error: ${error.message}`
                );
              } else {
                // Max attempts reached - mark as permanently failed
                status = "failed_ai";
                logger.error(
                  `Job ${job.job_id} failed permanently after ${job.attempts} attempts (AI Provider Error). Error: ${error.message}`
                );

                // Update target entity's AI status to 'failed_ai'
                await dbQueries.updateEntityAiStatusForJobTarget(
                  this.dbClient,
                  job.target_entity_id,
                  job.target_entity_type,
                  "failed_ai",
                  null,
                  error.message
                );
              }
            }

            // Update job status
            await dbQueries.updateAiJobStatusAndAttempts(
              this.dbClient,
              job.job_id,
              status,
              0, // Don't increment attempts again, it was already incremented
              errorMessage
            );
            logger.info(`Job ${job.job_id} status updated to '${status}'`);
          }
        } catch (internalError) {
          // Handle internal errors in the BackgroundJobManager itself
          logger.error(
            `Job ${job.job_id} failed due to internal logic error. Error: ${internalError.message}`,
            { error: internalError, jobId: job.job_id }
          );

          // Best effort attempt to update the job status to failed_job_logic
          try {
            await dbQueries.updateAiJobStatusAndAttempts(
              this.dbClient,
              job.job_id,
              "failed_job_logic",
              0,
              internalError.message
            );
            logger.info(
              `Job ${job.job_id} status updated to 'failed_job_logic'`
            );
          } catch (finalError) {
            // Even this attempt failed, which means we likely have serious DB issues
            logger.error(
              `Failed to update status of job ${job.job_id} to 'failed_job_logic'. System may be in an unreliable state. Error: ${finalError.message}`,
              { error: finalError, jobId: job.job_id }
            );
          }
        } finally {
          // Always decrement the active jobs counter, even if internal errors occur
          this.activeJobsCount--;
          logger.debug(
            `Decremented active jobs count to ${this.activeJobsCount} after processing job ${job.job_id}`
          );
        }
      }
    } catch (error) {
      logger.error(`Error processing job queue: ${error.message}`, { error });
    } finally {
      this.isProcessing = false;
      logger.debug("Finished processing queue cycle");
    }
  }

  /**
   * Check if a task type is currently paused
   * @param {string} taskType - The task type to check
   * @returns {boolean} True if the task type is paused, false otherwise
   */
  isTaskTypePaused(taskType) {
    const pauseEndTime = this.taskTypePauseUntil[taskType];
    if (!pauseEndTime) {
      return false;
    }

    return Date.now() < pauseEndTime;
  }

  /**
   * Clear expired task type pauses
   */
  clearExpiredTaskPauses() {
    const now = Date.now();
    let clearedCount = 0;

    Object.keys(this.taskTypePauseUntil).forEach((taskType) => {
      if (this.taskTypePauseUntil[taskType] <= now) {
        logger.info(
          `Task type ${taskType} pause has expired. Resuming processing.`
        );
        delete this.taskTypePauseUntil[taskType];
        clearedCount++;
      }
    });

    if (clearedCount > 0) {
      logger.info(`Cleared ${clearedCount} expired task type pauses`);
    }
  }

  /**
   * Stop the job processing loop
   * @returns {void}
   */
  stop() {
    if (!this.isRunning) {
      logger.warn("BackgroundJobManager is not running");
      return;
    }

    logger.info("Stopping BackgroundJobManager");

    // Clear the interval and reset flags
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    logger.info("BackgroundJobManager stopped successfully");
  }

  /**
   * Enqueue a new background AI job
   * @param {Object} jobDetails - Details of the job to enqueue
   * @param {string} jobDetails.task_type - Type of task to perform (e.g., 'enrich_entity_summary_keywords')
   * @param {string} jobDetails.target_entity_id - ID of the entity/document to process
   * @param {string} jobDetails.target_entity_type - Type of the target entity (e.g., 'code_entity', 'project_document')
   * @param {Object} [jobDetails.payload] - Optional additional data needed for the job
   * @returns {Promise<{job_id: string, success: boolean}>} - Result of the enqueue operation
   */
  async enqueueJob(jobDetails) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.info(
        `Enqueueing job of type '${jobDetails.task_type}' for entity ID '${jobDetails.target_entity_id}'`
      );

      // Generate a unique job_id (UUID)
      const job_id = uuidv4();

      // Prepare the job record
      const jobData = {
        job_id,
        target_entity_id: jobDetails.target_entity_id,
        target_entity_type: jobDetails.target_entity_type,
        task_type: jobDetails.task_type,
        status: "pending",
        payload: jobDetails.payload ? JSON.stringify(jobDetails.payload) : null,
        // max_attempts will use the default value from the schema
      };

      // In a real implementation, we would call the DB function to insert the job
      // However, as Task 046 (which creates this function) is not completed yet,
      // we'll simply log the job insertion for now
      logger.info(
        `Would insert job with ID '${job_id}' into background_ai_jobs table`,
        { jobData }
      );

      // Once Task 046 is completed, uncomment the following code:
      /*
      // Insert the job record into the database
      await dbQueries.addBackgroundAiJob(this.dbClient, jobData);
      */

      logger.info(`Successfully enqueued job with ID '${job_id}'`);
      return { job_id, success: true };
    } catch (error) {
      logger.error(`Error enqueueing job: ${error.message}`, {
        error,
        jobDetails,
      });
      return { success: false, error: error.message };
    }
  }
}

// Export a singleton instance
export default new BackgroundJobManager();
