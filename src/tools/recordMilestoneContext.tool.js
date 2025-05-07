/**
 * recordMilestoneContext.tool.js
 *
 * MCP tool implementation for recording milestone context
 * This tool creates a snapshot of the current context and performs
 * impact analysis for major milestones during development.
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { executeQuery } from "../db.js";
import * as ActiveContextManager from "../logic/ActiveContextManager.js";
import * as TimelineManagerLogic from "../logic/TimelineManagerLogic.js";
import * as LearningSystem from "../logic/LearningSystem.js";
import * as RelationshipContextManagerLogic from "../logic/RelationshipContextManagerLogic.js";
import * as SmartSearchServiceLogic from "../logic/SmartSearchServiceLogic.js";
import { logMessage } from "../utils/logger.js";

import {
  recordMilestoneContextInputSchema,
  recordMilestoneContextOutputSchema,
} from "../schemas/toolSchemas.js";

/**
 * Handler for record_milestone_context tool
 *
 * @param {object} input - Tool input parameters
 * @param {object} sdkContext - SDK context
 * @returns {Promise<object>} Tool output
 */
async function handler(input, sdkContext) {
  try {
    logMessage("INFO", `record_milestone_context tool started`, {
      milestoneName: input.name,
      category: input.milestoneCategory || "uncategorized",
      conversationId: input.conversationId,
    });

    // 1. Extract input parameters
    const {
      conversationId,
      name,
      description = "",
      customData = {},
      milestoneCategory = "uncategorized",
      assessImpact = true,
    } = input;

    // Validate essential parameters
    if (!name) {
      const error = new Error("Milestone name is required");
      error.code = "MISSING_NAME";
      throw error;
    }

    // 2. Gather active context
    let activeContextEntities = [];
    let activeFocus = null;
    let activeContextIds = [];

    try {
      activeContextEntities =
        await ActiveContextManager.getActiveContextAsEntities();
      activeFocus = await ActiveContextManager.getActiveFocus();
      activeContextIds = activeContextEntities.map((entity) => entity.id);

      logMessage("DEBUG", `Retrieved active context`, {
        entityCount: activeContextIds.length,
        hasFocus: !!activeFocus,
      });
    } catch (contextErr) {
      logMessage(
        "WARN",
        `Error retrieving active context, continuing with empty context`,
        {
          error: contextErr.message,
        }
      );
      // Continue with empty context instead of failing
    }

    // 3. Create the snapshot data
    const snapshotData = {
      milestoneCategory,
      name,
      description,
      activeFocus,
      entityIds: activeContextIds,
      customData,
      timestamp: Date.now(),
      conversationId,
    };

    // 4. Record the milestone event in the timeline
    let milestoneEventId;
    try {
      milestoneEventId = await TimelineManagerLogic.recordEvent(
        "milestone_created",
        {
          name,
          category: milestoneCategory,
          entityCount: activeContextIds.length,
          timestamp: Date.now(),
        },
        activeContextIds,
        conversationId
      );
      logMessage("DEBUG", `Recorded milestone event in timeline`, {
        eventId: milestoneEventId,
      });
    } catch (timelineErr) {
      logMessage("ERROR", `Failed to record milestone event in timeline`, {
        error: timelineErr.message,
        name,
        category: milestoneCategory,
      });
      // This is a critical failure, rethrow
      throw timelineErr;
    }

    // 5. Create snapshot in the database
    let milestoneId;
    try {
      milestoneId = await TimelineManagerLogic.createSnapshot(
        snapshotData,
        name,
        description,
        milestoneEventId
      );
      logMessage("INFO", `Created milestone with ID: ${milestoneId}`);

      // Also save milestone in context_states table
      try {
        const stateId = uuidv4();
        const currentTime = new Date().toISOString();
        const stateData = JSON.stringify(snapshotData);

        const insertStateQuery = `
          INSERT INTO context_states (
            state_id, milestone_id, conversation_id, state_type, 
            state_data, created_at, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        const stateParams = [
          stateId,
          milestoneId,
          conversationId,
          "milestone",
          stateData,
          currentTime,
          JSON.stringify({ name, description, category: milestoneCategory }),
        ];

        await executeQuery(insertStateQuery, stateParams);
        logMessage(
          "INFO",
          `Saved milestone state in context_states with ID: ${stateId}`
        );
      } catch (stateErr) {
        logMessage(
          "ERROR",
          `Failed to save milestone in context_states table`,
          {
            error: stateErr.message,
            milestoneId,
          }
        );
        // Continue despite error, as we already have the snapshot
      }
    } catch (snapshotErr) {
      logMessage("ERROR", `Failed to create milestone snapshot`, {
        error: snapshotErr.message,
        name,
        eventId: milestoneEventId,
      });
      // This is a critical failure, rethrow
      throw snapshotErr;
    }

    // 6. Initialize impact assessment result
    let impactAssessment = null;

    // 7. If impact assessment is requested, perform it
    if (assessImpact) {
      try {
        logMessage("INFO", `Starting impact assessment for milestone`, {
          milestoneId,
          category: milestoneCategory,
        });
        impactAssessment = await _assessMilestoneImpact(
          milestoneId,
          milestoneCategory,
          activeContextIds
        );
      } catch (impactErr) {
        logMessage("WARN", `Failed to assess milestone impact`, {
          error: impactErr.message,
          milestoneId,
        });
        // Set a basic impact assessment with error information
        impactAssessment = {
          impactScore: 0,
          impactLevel: "unknown",
          impactSummary: `Unable to assess impact: ${impactErr.message}`,
          error: impactErr.message,
          scopeMetrics: {
            directlyModifiedEntities: activeContextIds.length,
            potentiallyImpactedEntities: 0,
            impactedComponents: 0,
            criticalPathsCount: 0,
          },
        };
      }
    } else {
      logMessage("DEBUG", `Skipping impact assessment (not requested)`);
    }

    // 8. Trigger background pattern analysis (don't await)
    setTimeout(() => {
      logMessage(
        "DEBUG",
        `Starting background pattern analysis for milestone: ${milestoneId}`
      );
      LearningSystem.analyzePatternsAroundMilestone(milestoneId).catch(
        (error) => {
          logMessage("ERROR", `Error in background pattern analysis`, {
            error: error.message,
            milestoneId,
          });
        }
      );
    }, 100);

    // 9. Return the tool response
    logMessage("INFO", `record_milestone_context tool completed successfully`, {
      milestoneId,
      entityCount: activeContextIds.length,
      hasImpactAssessment: !!impactAssessment,
    });

    const responseData = {
      message: `Milestone "${name}" recorded successfully with ${activeContextIds.length} related entities.`,
      milestoneId,
      status: "success",
      milestoneCategory,
      relatedEntitiesCount: activeContextIds.length,
      impactAssessment,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responseData),
        },
      ],
    };
  } catch (error) {
    // Log detailed error information
    logMessage("ERROR", `Error in record_milestone_context tool`, {
      error: error.message,
      stack: error.stack,
      input: {
        name: input.name,
        category: input.milestoneCategory,
        conversationId: input.conversationId,
      },
    });

    // Return error response
    const errorResponse = {
      error: true,
      errorCode: error.code || "MILESTONE_RECORDING_FAILED",
      errorDetails: error.message,
      milestoneId: null,
      status: "error",
      milestoneCategory: input.milestoneCategory || "uncategorized",
      relatedEntitiesCount: 0,
      impactAssessment: {
        error: error.message,
      },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorResponse),
        },
      ],
    };
  }
}

/**
 * Assesses the impact of a milestone by analyzing relationships and dependencies
 *
 * @param {string} milestoneId - ID of the milestone
 * @param {string} category - Category of the milestone
 * @param {string[]} activeContextIds - IDs of entities in the active context
 * @returns {Promise<Object>} Impact assessment results
 * @private
 */
async function _assessMilestoneImpact(milestoneId, category, activeContextIds) {
  try {
    logMessage("DEBUG", `Assessing impact for milestone: ${milestoneId}`, {
      category,
      entityCount: activeContextIds?.length || 0,
    });

    // Skip if no active context IDs
    if (!activeContextIds || activeContextIds.length === 0) {
      logMessage(
        "DEBUG",
        `No active context entities, skipping detailed impact assessment`
      );
      return {
        impactScore: 0,
        impactLevel: "none",
        impactSummary: "No code entities were modified in this milestone.",
        scopeMetrics: {
          directlyModifiedEntities: 0,
          potentiallyImpactedEntities: 0,
          impactedComponents: 0,
          criticalPathsCount: 0,
        },
      };
    }

    // 1. Fetch full details of active context entities
    let entities = [];
    try {
      logMessage(
        "DEBUG",
        `Fetching details for ${activeContextIds.length} entities`
      );

      const entityDetails = await Promise.all(
        activeContextIds.map(async (id) => {
          try {
            // Fetch entity details from database
            const query = `SELECT * FROM code_entities WHERE entity_id = ?`;
            const result = await executeQuery(query, [id]);
            return result.length > 0 ? result[0] : null;
          } catch (queryErr) {
            logMessage("WARN", `Failed to fetch entity details`, {
              error: queryErr.message,
              entityId: id,
            });
            return null;
          }
        })
      );

      entities = entityDetails.filter(Boolean);
      logMessage(
        "DEBUG",
        `Retrieved details for ${entities.length}/${activeContextIds.length} entities`
      );
    } catch (fetchErr) {
      logMessage("ERROR", `Failed to fetch entity details`, {
        error: fetchErr.message,
      });
      // Return a minimal assessment
      return {
        impactScore: 0.1,
        impactLevel: "unknown",
        impactSummary: `Impact could not be fully assessed due to database error: ${fetchErr.message}`,
        scopeMetrics: {
          directlyModifiedEntities: activeContextIds.length,
          potentiallyImpactedEntities: 0,
          impactedComponents: 0,
          criticalPathsCount: 0,
        },
        error: fetchErr.message,
      };
    }

    // 2. Analyze relationships to find potentially impacted entities
    const impactedEntityIds = new Set(activeContextIds);
    const criticalPaths = [];
    const componentImpacts = new Map(); // Map to track impacts by component/directory

    // Build a map of entity types for quick reference
    const entityTypeMap = new Map();
    entities.forEach((entity) => {
      entityTypeMap.set(entity.entity_id, entity.entity_type);
    });

    // 3. For each entity, find its relationships
    try {
      for (const entity of entities) {
        // Get outgoing relationships (dependencies on other entities)
        const outgoingRelationships =
          await RelationshipContextManagerLogic.getRelationships(
            entity.entity_id,
            "outgoing"
          );

        logMessage(
          "DEBUG",
          `Retrieved ${outgoingRelationships.length} outgoing relationships for entity`,
          {
            entityId: entity.entity_id,
            entityType: entity.entity_type,
          }
        );

        // For each relationship, add the target to potentially impacted entities
        for (const rel of outgoingRelationships) {
          // Only add if it's not already in the active context
          if (!impactedEntityIds.has(rel.target_entity_id)) {
            impactedEntityIds.add(rel.target_entity_id);

            // Check if this forms a critical path
            if (
              rel.relationship_type === "calls" ||
              rel.relationship_type === "extends" ||
              rel.relationship_type === "implements"
            ) {
              criticalPaths.push({
                source: entity.entity_id,
                target: rel.target_entity_id,
                type: rel.relationship_type,
                criticality: 0.8, // Default high criticality for these types
              });
            }
          }
        }

        // Track component impacts
        // Extract component/directory from file path
        const filePath = entity.file_path || "";
        const component = filePath.split("/").slice(0, 2).join("/");
        if (component) {
          const currentCount = componentImpacts.get(component) || 0;
          componentImpacts.set(component, currentCount + 1);
        }
      }
    } catch (relErr) {
      logMessage("WARN", `Error analyzing relationships`, {
        error: relErr.message,
        milestoneId,
      });
      // Continue with partial data
    }

    logMessage("DEBUG", `Completed relationship analysis`, {
      impactedEntities: impactedEntityIds.size,
      criticalPaths: criticalPaths.length,
      componentCount: componentImpacts.size,
    });

    // 4. Calculate impact metrics
    const directlyModifiedCount = activeContextIds.length;
    const potentiallyImpactedCount =
      impactedEntityIds.size - directlyModifiedCount;
    const impactedComponentsCount = componentImpacts.size;
    const criticalPathsCount = criticalPaths.length;

    // 5. Calculate impact score based on metrics
    let impactScore;
    let impactLevel;

    try {
      // Calculate base impact score (0-1)
      const baseImpactScore = Math.min(
        1,
        directlyModifiedCount * 0.02 +
          potentiallyImpactedCount * 0.01 +
          impactedComponentsCount * 0.1 +
          criticalPathsCount * 0.05
      );

      // Adjust based on milestone category
      let categoryMultiplier = 1;
      switch (category) {
        case "major_feature":
          categoryMultiplier = 1.2;
          break;
        case "refactoring":
          categoryMultiplier = 1.5; // Refactorings often have wide impact
          break;
        case "bug_fix":
          categoryMultiplier = 0.7; // Bug fixes typically have more limited scope
          break;
        case "critical_fix":
          categoryMultiplier = 1.3; // Critical fixes may touch core parts
          break;
        default:
          categoryMultiplier = 1;
      }

      impactScore = Math.min(1, baseImpactScore * categoryMultiplier);

      // Determine impact level
      if (impactScore < 0.2) {
        impactLevel = "low";
      } else if (impactScore < 0.5) {
        impactLevel = "medium";
      } else if (impactScore < 0.8) {
        impactLevel = "high";
      } else {
        impactLevel = "critical";
      }

      logMessage("INFO", `Calculated impact assessment`, {
        impactScore,
        impactLevel,
        directlyModified: directlyModifiedCount,
        potentiallyImpacted: potentiallyImpactedCount,
        components: impactedComponentsCount,
      });
    } catch (calcErr) {
      logMessage("ERROR", `Error calculating impact score`, {
        error: calcErr.message,
      });
      // Provide default values
      impactScore = 0.3;
      impactLevel = "medium";
    }

    // 6. Generate impact summary text
    let impactSummary;
    try {
      impactSummary = _generateImpactSummary(
        impactLevel,
        directlyModifiedCount,
        potentiallyImpactedCount,
        impactedComponentsCount,
        criticalPathsCount,
        category
      );
    } catch (summaryErr) {
      logMessage("WARN", `Error generating impact summary`, {
        error: summaryErr.message,
      });
      // Provide default summary
      impactSummary = `This milestone has a ${impactLevel} impact, affecting ${directlyModifiedCount} entities directly and potentially impacting ${potentiallyImpactedCount} others.`;
    }

    // 7. Return the complete assessment
    return {
      impactScore,
      impactLevel,
      impactSummary,
      scopeMetrics: {
        directlyModifiedEntities: directlyModifiedCount,
        potentiallyImpactedEntities: potentiallyImpactedCount,
        impactedComponents: impactedComponentsCount,
        criticalPathsCount,
      },
      componentBreakdown: Object.fromEntries(componentImpacts),
      criticalPathsTop: criticalPaths.slice(0, 5), // Only include top 5 critical paths
    };
  } catch (error) {
    logMessage("ERROR", `Error in impact assessment`, {
      error: error.message,
      stack: error.stack,
      milestoneId,
      category,
    });

    // Return a minimal assessment with error info
    return {
      impactScore: 0.1,
      impactLevel: "unknown",
      impactSummary: `Impact assessment encountered an error: ${error.message}`,
      error: error.message,
      scopeMetrics: {
        directlyModifiedEntities: activeContextIds
          ? activeContextIds.length
          : 0,
        potentiallyImpactedEntities: 0,
        impactedComponents: 0,
        criticalPathsCount: 0,
      },
    };
  }
}

/**
 * Generates an impact summary text based on assessment metrics
 *
 * @param {string} impactLevel - Level of impact (low, medium, high, critical)
 * @param {number} directCount - Count of directly modified entities
 * @param {number} indirectCount - Count of indirectly impacted entities
 * @param {number} componentCount - Count of impacted components
 * @param {number} criticalPathCount - Count of critical paths
 * @param {string} category - Milestone category
 * @returns {string} Human-readable impact summary
 * @private
 */
function _generateImpactSummary(
  impactLevel,
  directCount,
  indirectCount,
  componentCount,
  criticalPathCount,
  category
) {
  try {
    // Start with impact level
    let summary = `This ${category} milestone has a ${impactLevel} impact, `;

    // Add direct and indirect counts
    summary += `directly modifying ${directCount} entities and potentially affecting ${indirectCount} additional entities. `;

    // Add component information
    if (componentCount > 0) {
      summary += `Changes span ${componentCount} component${
        componentCount === 1 ? "" : "s"
      }. `;
    }

    // Add critical path information if relevant
    if (criticalPathCount > 0) {
      summary += `Found ${criticalPathCount} critical dependency path${
        criticalPathCount === 1 ? "" : "s"
      } that may require careful testing. `;
    }

    // Add category-specific advice
    switch (category) {
      case "refactoring":
        summary +=
          "Since this is a refactoring, consider comprehensive regression testing.";
        break;
      case "major_feature":
        summary +=
          "As a major feature, ensure adequate test coverage for new functionality.";
        break;
      case "bug_fix":
        summary +=
          "For this bug fix, focus testing on the specific issue resolution.";
        break;
      case "critical_fix":
        summary +=
          "This critical fix requires careful validation in production-like environments.";
        break;
    }

    return summary;
  } catch (error) {
    logMessage("WARN", `Error generating impact summary text`, {
      error: error.message,
    });
    // Return a simple fallback summary
    return `This milestone has a ${impactLevel} impact, affecting ${directCount} entities directly.`;
  }
}

// Export the tool definition for server registration
export default {
  name: "record_milestone_context",
  description:
    "Records a development milestone and its context, creating a snapshot for reference and learning",
  inputSchema: recordMilestoneContextInputSchema,
  outputSchema: recordMilestoneContextOutputSchema,
  handler,
};
