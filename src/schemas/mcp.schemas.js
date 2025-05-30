/**
 * MCP Tool Schemas
 *
 * This file contains reference Zod schemas for MCP tool inputs and outputs.
 * Note: These schemas are primarily for documentation purposes and may not be used directly
 * as the schemas are now embedded in the tool definition in src/main.js.
 */

import { z } from "zod";

/**
 * Schema for ping_server tool output
 * Validates that the response is exactly "pong" and timestamp is a valid ISO8601 datetime string
 *
 * Note: This schema is a reference only. The actual implementation uses
 * inlined schema definitions in the tool registration.
 */
export const PingServerOutputSchema = z.object({
  response: z.literal("pong"),
  timestamp: z.string().datetime(), // Validates ISO8601 format
});

// Define future MCP tool schemas below as references
// Example format:
// export const ToolNameInputSchema = z.object({ ... });
// export const ToolNameOutputSchema = z.object({ ... });

/**
 * Schema for initialize_conversation_context tool input
 * Validates the input parameters for initializing a conversation context session
 */
export const InitializeConversationContextInputSchema = z.object({
  initialQuery: z.string().optional(), // The AI agent's initial query or prompt
  max_context_tokens: z.number().int().positive().optional(), // Maximum number of tokens for context response budgeting
});

/**
 * Schema for project structure data returned by RetrievalService.getProjectStructureSummary()
 */
const ProjectStructureSchema = z
  .object({
    summary: z.string(), // Dynamic summary string incorporating key counts
    entityCountsByLanguage: z.record(z.string(), z.number()), // e.g., { javascript: 150, python: 50 }
    entityCountsByType: z.record(z.string(), z.number()), // e.g., { function_declaration: 80, class_declaration: 20 }
    documentCountsByType: z.record(z.string(), z.number()), // e.g., { markdown: 10, json: 5 }
    aiProcessingStatus: z.object({
      codeEntities: z.record(z.string(), z.number()), // e.g., { completed: 90, pending: 10 }
      projectDocuments: z.record(z.string(), z.number()), // e.g., { completed: 5, pending: 5 }
    }),
    relationshipTypeCounts: z.record(z.string(), z.number()).optional(), // e.g., { CALLS_FUNCTION: 50, IMPORTS: 25 }
    error: z.string().optional(), // Present if there was an error during generation
  })
  .nullable() // Allow null values when error occurs during generation
  .optional(); // Optional because it might not be present if an error occurs during its generation

/**
 * Schema for individual recent conversation topic
 */
const RecentConversationTopicSchema = z.object({
  topicId: z.string().uuid(), // UUID of the conversation topic
  summary: z.string(), // Summary text of the topic
  purposeTag: z.string().optional(), // Optional purpose/category tag for the topic
});

/**
 * Schema for recent conversations data returned by RetrievalService.getRecentConversationTopicsSummary()
 */
const RecentConversationsSchema = z
  .object({
    topics: z.array(RecentConversationTopicSchema), // Array of recent conversation topics
  })
  .optional(); // Optional because it might be empty or not present if error during its generation

/**
 * Schema for individual key document in architecture context
 */
const KeyDocumentSchema = z.object({
  filePath: z.string(), // Relative path to the document (e.g., "README.md", "docs/architecture.md")
  aiStatus: z.string(), // AI processing status: 'completed', 'pending', 'not_found', 'error'
  summarySnippet: z.string(), // AI summary if available, otherwise raw content snippet or error message
});

/**
 * Schema for architecture context data returned by RetrievalService.getArchitectureContextSummary()
 */
const ArchitectureContextSchema = z
  .object({
    keyDocuments: z.array(KeyDocumentSchema), // Array of key architecture documents
    overallProjectGoalHint: z.string().optional(), // Optional overall project goal extracted from primary documents
  })
  .optional(); // Optional because it might be empty or not present if error during its generation

/**
 * Schema for individual initial query context snippet returned by FTS search
 */
const InitialQuerySnippetSchema = z.object({
  filePath: z.string(), // File path of the code entity or document
  entityName: z.string().optional(), // Name of the code entity (only for code entities)
  type: z.string(), // Entity type (function_declaration, class_declaration, etc.) or document file type
  aiStatus: z.string(), // AI processing status: 'completed', 'pending', 'error', etc.
  snippet: z.string(), // Content snippet prioritizing AI summary > FTS highlighted snippet > raw content
});

/**
 * Schema for initialize_conversation_context tool output
 * Validates the response structure for conversation context initialization
 */
export const InitializeConversationContextOutputSchema = z.object({
  conversationId: z.string().uuid(), // A new UUID for this conversation session
  initialContextSummary: z.string().optional(), // A brief summary, e.g., confirming query logging
  comprehensiveContext: z
    .object({
      projectStructure: ProjectStructureSchema,
      recentConversations: RecentConversationsSchema,
      architectureContext: ArchitectureContextSchema,
      initialQueryContextSnippets: z
        .array(InitialQuerySnippetSchema)
        .optional(), // FTS-based snippets for initial query
    })
    .passthrough() // Use passthrough to allow other fields to be added incrementally
    .optional(), // Optional because the entire object might be absent on certain critical errors
  processedOk: z.boolean(), // Indicates if the tool call was processed without critical server errors
});

/**
 * Schema for retrieve_relevant_context tool input
 * Validates the input parameters for retrieving relevant context based on a query
 */
export const RetrieveRelevantContextInputSchema = z.object({
  query: z.string().min(1), // The agent's query for context; must not be empty
  conversationId: z.string().uuid(), // The active conversation session ID
  tokenBudget: z.number().int().positive(), // Maximum desired token count for returned snippets
  retrievalParameters: z
    .object({
      // Define potential parameters as they become concrete in later stories.
      // For V2 MVP / Story 4.1, this can be a simple optional object.
      // Example future parameters (commented out for now):
      // includeCode: z.boolean().optional(),
      // includeDocs: z.boolean().optional(),
      // maxSnippetsPerSource: z.number().int().positive().optional(),
      // filterByFilePaths: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(), // Allow unknown keys initially, make specific later
});

/**
 * Schema for relationship context metadata attached to snippets derived from relationship expansion
 * Used for code entities discovered through RelationshipManager.getRelatedEntities()
 */
export const RelationshipContextSchema = z.object({
  relatedToSeedEntityId: z.string(), // The original entity ID we expanded from
  relationshipType: z.string(), // Type of relationship (e.g., 'CALLS_FUNCTION', 'IMPLEMENTS_INTERFACE', 'EXTENDS_CLASS')
  direction: z.enum(["outgoing", "incoming"]), // Direction of the relationship from the seed entity's perspective
  customMetadata: z.any().optional(), // Optional custom metadata from the relationship record
});

/**
 * Schema for individual context snippets returned by retrieve_relevant_context tool
 * Updated for Task 239 to include optional relationshipContext for relationship-derived snippets
 */
export const ContextSnippetSchema = z
  .object({
    id: z.string(), // Unique identifier for the snippet
    type: z.string(), // Type of snippet (e.g., 'code_entity', 'project_document')
    content: z.string(), // The content/snippet text
    score: z.number().optional(), // Relevance score (optional)
    filePath: z.string().optional(), // File path where content originates (optional)
    relationshipContext: RelationshipContextSchema.optional(), // Task 239: Optional relationship context for relationship-derived snippets
    // Add more fields as defined by retrieval stories
  })
  .passthrough(); // Allow additional fields to be added incrementally

/**
 * Schema for retrieval summary metadata returned by retrieve_relevant_context tool
 * Updated for Task 223 to reflect compression statistics structure from CompressionService
 */
export const RetrievalSummarySchema = z
  .object({
    sourcesConsulted: z.array(z.string()).optional(), // Keep for backward compatibility if still relevant
    snippetsFoundBeforeCompression: z.number().int(), // Number of candidate snippets before compression
    snippetsReturnedAfterCompression: z.number().int(), // Number of snippets after compression
    estimatedTokensIn: z.number().int(), // Sum of estimated tokens from all input candidate snippets
    estimatedTokensOut: z.number().int(), // Sum of estimated tokens from final output snippets
    tokenBudgetGiven: z.number().int(), // Original token budget provided by the agent
    tokenBudgetRemaining: z.number().int(), // Remaining token budget after compression
  })
  .passthrough()
  .optional(); // Allow additional fields and make the entire summary optional

/**
 * Schema for retrieve_relevant_context tool output
 * Validates the response structure for context retrieval
 */
export const RetrieveRelevantContextOutputSchema = z.object({
  contextSnippets: z.array(ContextSnippetSchema), // Array of relevant context snippets
  retrievalSummary: RetrievalSummarySchema, // Metadata about the retrieval process
  processedOk: z.boolean(), // Indicates if the tool call was processed without critical server errors
});
