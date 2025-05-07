/**
 * Schema definitions for MCP tool inputs and outputs
 * Using Zod for schema validation
 */

import { z } from "zod";
import { DEFAULT_TOKEN_BUDGET } from "../config.js";

/**
 * Schema for initialize_conversation_context tool input
 * Note: projectId field is explicitly removed as the server operates
 * with a database instance dedicated to a single project
 */
export const initializeConversationContextInputSchema = {
  // No projectId field as per the blueprint
  initialQuery: z.string().optional(),
  focusHint: z
    .object({
      type: z.string(),
      identifier: z.string(),
    })
    .optional(),
  includeArchitecture: z.boolean().optional().default(true),
  includeRecentConversations: z.boolean().optional().default(true),
  maxCodeContextItems: z.number().optional().default(5),
  maxRecentChanges: z.number().optional().default(5),
  contextDepth: z
    .enum(["minimal", "standard", "comprehensive"])
    .optional()
    .default("standard"),
  tokenBudget: z.number().optional().default(DEFAULT_TOKEN_BUDGET),
};

/**
 * Schema for initialize_conversation_context tool output
 * Includes comprehensive context object
 */
export const initializeConversationContextOutputSchema = {
  conversationId: z.string(),
  initialContextSummary: z.string(),
  predictedIntent: z.string().optional(),
  comprehensiveContext: z
    .object({
      codeContext: z.array(z.any()).optional(),
      architectureContext: z
        .object({
          summary: z.string(),
          sources: z.array(
            z.object({
              name: z.string(),
              path: z.string(),
            })
          ),
        })
        .nullable(),
      recentConversations: z
        .array(
          z.object({
            timestamp: z.number(),
            summary: z.string(),
            purpose: z.string(),
          })
        )
        .optional(),
      activeWorkflows: z
        .array(
          z.object({
            name: z.string(),
            description: z.string(),
            timestamp: z.number(),
          })
        )
        .optional(),
      projectStructure: z.any().nullable(),
      recentChanges: z
        .array(
          z.object({
            timestamp: z.number(),
            files: z.array(z.string()),
            summary: z.string(),
          })
        )
        .optional(),
      globalPatterns: z
        .array(
          z.object({
            name: z.string(),
            type: z.string(),
            description: z.string(),
            confidence: z.number(),
          })
        )
        .optional(),
    })
    .optional(),
};

/**
 * Schema for update_conversation_context tool input
 * Note: projectId field is explicitly removed as the server operates
 * with a database instance dedicated to a single project
 */
export const updateConversationContextInputSchema = {
  // No projectId field as per the blueprint
  conversationId: z.string(),
  newMessages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      })
    )
    .optional()
    .default([]),
  codeChanges: z
    .array(
      z.object({
        filePath: z.string(),
        newContent: z.string(),
        languageHint: z.string().optional(),
      })
    )
    .optional()
    .default([]),
  preserveContextOnTopicShift: z.boolean().optional().default(true),
  contextIntegrationLevel: z
    .enum(["minimal", "balanced", "aggressive"])
    .optional()
    .default("balanced"),
  trackIntentTransitions: z.boolean().optional().default(true),
  tokenBudget: z.number().optional().default(DEFAULT_TOKEN_BUDGET),
};

/**
 * Schema for update_conversation_context tool output
 * Includes continuity tracking, context synthesis, and intent transition detection
 */
export const updateConversationContextOutputSchema = {
  status: z.enum(["success", "partial", "failure"]),
  updatedFocus: z
    .object({
      type: z.string(),
      identifier: z.string(),
    })
    .optional(),
  contextContinuity: z.object({
    preserved: z.boolean(),
    topicShift: z.boolean(),
    intentTransition: z.boolean(),
  }),
  contextSynthesis: z
    .object({
      summary: z.string(),
      topPriorities: z.array(z.string()).optional(),
    })
    .optional(),
  intentTransition: z
    .object({
      from: z.string().nullable(),
      to: z.string().nullable(),
      confidence: z.number(),
    })
    .optional(),
};

/**
 * Schema for retrieve_relevant_context tool input
 * Note: projectId field is explicitly removed as the server operates
 * with a database instance dedicated to a single project
 */
export const retrieveRelevantContextInputSchema = {
  // No projectId field as per the blueprint
  conversationId: z.string(),
  query: z.string(),
  tokenBudget: z.number().optional().default(DEFAULT_TOKEN_BUDGET),
  constraints: z
    .object({
      entityTypes: z.array(z.string()).optional(),
      filePaths: z.array(z.string()).optional(),
      includeConversation: z.boolean().optional().default(true),
      crossTopicSearch: z.boolean().optional().default(false),
      focusOverride: z
        .object({ type: z.string(), identifier: z.string() })
        .optional(),
    })
    .optional()
    .default({}),
  contextFilters: z
    .object({
      minRelevanceScore: z.number().optional().default(0.3),
      excludeTypes: z.array(z.string()).optional(),
      preferredLanguages: z.array(z.string()).optional(),
      timeframe: z
        .object({
          from: z.number().optional(),
          to: z.number().optional(),
        })
        .optional(),
    })
    .optional()
    .default({}),
  weightingStrategy: z
    .enum(["relevance", "recency", "hierarchy", "balanced"])
    .optional()
    .default("balanced"),
  balanceStrategy: z
    .enum(["proportional", "equal_representation", "priority_based"])
    .optional()
    .default("proportional"),
  contextBalance: z
    .union([
      z.enum(["auto", "code_heavy", "balanced", "documentation_focused"]),
      z.object({
        code: z.number().optional(),
        conversation: z.number().optional(),
        documentation: z.number().optional(),
        patterns: z.number().optional(),
      }),
    ])
    .optional()
    .default("auto"),
  sourceTypePreferences: z
    .object({
      includePatterns: z.boolean().optional().default(true),
      includeDocumentation: z.boolean().optional().default(true),
      prioritizeTestCases: z.boolean().optional().default(false),
      prioritizeExamples: z.boolean().optional().default(false),
    })
    .optional()
    .default({}),
};

/**
 * Schema for retrieve_relevant_context tool output
 * Includes enhanced context snippets with confidence scoring,
 * source attribution, and relevance explanations
 */
export const retrieveRelevantContextOutputSchema = {
  contextSnippets: z.array(
    z.object({
      type: z.string(), // 'code', 'conversation', 'documentation', 'pattern'
      content: z.string(),
      entity_id: z.string(),
      relevanceScore: z.number(),
      confidenceScore: z.number(),
      metadata: z.any(), // Flexible metadata based on type
      sourceAttribution: z.string(),
      relevanceExplanation: z.string(),
    })
  ),
  retrievalSummary: z.string(),
  contextMetrics: z
    .object({
      totalFound: z.number(),
      selected: z.number(),
      averageConfidence: z.number(),
      typeDistribution: z.object({
        code: z.number(),
        conversation: z.number(),
        documentation: z.number(),
        pattern: z.number(),
      }),
    })
    .optional(),
};

/**
 * Schema for record_milestone_context tool input
 * Includes milestone categorization and impact assessment control
 */
export const recordMilestoneContextInputSchema = {
  conversationId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  customData: z.any().optional(),
  milestoneCategory: z
    .enum([
      "bug_fix",
      "feature_completion",
      "refactoring",
      "documentation",
      "test",
      "configuration",
      "uncategorized",
    ])
    .optional()
    .default("uncategorized"),
  assessImpact: z.boolean().optional().default(true),
};

/**
 * Schema for record_milestone_context tool output
 * Includes milestone category, related entities count, and detailed impact assessment
 */
export const recordMilestoneContextOutputSchema = {
  milestoneId: z.string(),
  status: z.string(),
  milestoneCategory: z.string(),
  relatedEntitiesCount: z.number(),
  impactAssessment: z
    .object({
      impactScore: z.number(),
      impactLevel: z.string(),
      impactSummary: z.string(),
      scopeMetrics: z
        .object({
          directlyModifiedEntities: z.number(),
          potentiallyImpactedEntities: z.number(),
          impactedComponents: z.number(),
          criticalPathsCount: z.number(),
        })
        .optional(),
      stabilityRisk: z.number().optional(),
      criticalPaths: z
        .array(
          z.object({
            sourceId: z.string(),
            path: z.string(),
            dependencyCount: z.number(),
          })
        )
        .optional(),
      mostImpactedComponents: z
        .array(
          z.object({
            name: z.string(),
            count: z.number(),
          })
        )
        .optional(),
      error: z.string().optional(),
    })
    .nullable(),
};

/**
 * Schema for finalize_conversation_context tool input
 * Includes enhanced options for learning extraction, pattern promotion,
 * related topics synthesis, and next steps generation
 */
export const finalizeConversationContextInputSchema = {
  conversationId: z.string(),
  clearActiveContext: z.boolean().optional().default(false),
  extractLearnings: z.boolean().optional().default(true),
  promotePatterns: z.boolean().optional().default(true),
  synthesizeRelatedTopics: z.boolean().optional().default(true),
  generateNextSteps: z.boolean().optional().default(true),
  outcome: z
    .enum(["completed", "abandoned", "paused", "reference_only"])
    .optional()
    .default("completed"),
};

/**
 * Schema for finalize_conversation_context tool output
 * Includes substantially richer output with extracted learnings, promoted patterns,
 * related conversations synthesis, and next steps suggestions
 */
export const finalizeConversationContextOutputSchema = {
  status: z.string(),
  summary: z.string(),
  purpose: z.string(),

  // Extracted learnings with confidence scores
  extractedLearnings: z
    .object({
      learnings: z.array(
        z.object({
          type: z.string(),
          content: z.string(),
          confidence: z.number(),
          // Other properties depend on learning type
          patternId: z.string().optional(),
          context: z.array(z.any()).optional(),
          messageReference: z.string().optional(),
          relatedIssues: z.array(z.any()).optional(),
          alternatives: z.array(z.string()).optional(),
          rationale: z.string().optional(),
          codeReferences: z.array(z.any()).optional(),
          applicability: z.number().optional(),
        })
      ),
      count: z.number(),
      byType: z.record(z.string(), z.number()),
      averageConfidence: z.number(),
      error: z.string().optional(),
    })
    .nullable(),

  // Promoted patterns
  promotedPatterns: z
    .object({
      promoted: z.number(),
      patterns: z.array(
        z.object({
          patternId: z.string(),
          name: z.string(),
          type: z.string(),
          promoted: z.boolean(),
          confidence: z.number(),
        })
      ),
      error: z.string().optional(),
    })
    .nullable(),

  // Related conversations synthesis
  relatedConversations: z
    .object({
      relatedCount: z.number(),
      conversations: z.array(
        z.object({
          conversationId: z.string(),
          summary: z.string(),
          timestamp: z.number(),
          similarityScore: z.number(),
          commonTopics: z.array(z.string()),
        })
      ),
      synthesizedInsights: z.array(
        z.object({
          topic: z.string(),
          insight: z.string(),
          conversationCount: z.number(),
          sourceSummaries: z.array(
            z.object({
              conversationId: z.string(),
              summary: z.string(),
            })
          ),
        })
      ),
      error: z.string().optional(),
    })
    .nullable(),

  // Next steps and follow-up suggestions
  nextSteps: z
    .object({
      suggestedNextSteps: z.array(
        z.object({
          action: z.string(),
          priority: z.enum(["high", "medium", "low"]),
          rationale: z.string(),
        })
      ),
      followUpTopics: z.array(
        z.object({
          topic: z.string(),
          priority: z.enum(["high", "medium", "low"]),
          rationale: z.string(),
        })
      ),
      referenceMaterials: z.array(
        z.object({
          title: z.string(),
          path: z.string(),
          type: z.string(),
          relevance: z.number(),
        })
      ),
      error: z.string().optional(),
    })
    .nullable(),
};
