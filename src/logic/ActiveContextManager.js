/**
 * ActiveContextManager.js
 *
 * Manages the "Active Context" in-memory for the current conversation.
 * Provides functions to get, set, and manipulate the entities and focus
 * that are currently active in the developer's context.
 */

import { executeQuery } from "../db.js";
import * as ContextPrioritizerLogic from "./ContextPrioritizerLogic.js";
import * as ContextCompressorLogic from "./ContextCompressorLogic.js";

/**
 * @typedef {Object} FocusArea
 * @property {string} focus_id - Unique identifier for the focus area
 * @property {string} focus_type - Type of focus area ('file', 'directory', 'task_type')
 * @property {string} identifier - Primary identifier for the focus area (e.g., file path)
 * @property {string} description - Human-readable description of the focus area
 * @property {string[]} related_entity_ids - Array of related entity IDs
 * @property {string[]} keywords - Array of keywords related to this focus area
 * @property {number} last_activated_at - Timestamp when this focus area was last active
 * @property {boolean} is_active - Whether this focus area is currently active
 */

/**
 * @typedef {Object} CodeEntity
 * @property {string} id - Unique identifier for the code entity
 * @property {string} path - File path of the code entity
 * @property {string} type - Type of code entity ('file', 'function', 'class', etc.)
 * @property {string} name - Name of the code entity
 * @property {string} content - Content of the code entity
 * @property {string} symbol_path - Full symbol path of the entity
 * @property {number} version - Version number of the entity
 * @property {string} parent_id - ID of the parent entity, if any
 * @property {string} created_at - Timestamp when entity was created
 * @property {string} updated_at - Timestamp when entity was last updated
 */

/**
 * @typedef {Object} Snippet
 * @property {string} entity_id - ID of the entity
 * @property {string} summarizedContent - Compressed/summarized content
 * @property {number} originalScore - Original relevance score
 * @property {string} type - Type of snippet
 */

// Module-scoped state variables
/**
 * Set of entity IDs currently in active context
 * @type {Set<string>}
 */
const activeEntityIds = new Set();

/**
 * Current focus area
 * @type {FocusArea|null}
 */
let activeFocus = null;

/**
 * History of context changes for short-term memory
 * @type {Array<{timestamp: number, added?: string[], removed?: string[]}>}
 */
const contextHistory = [];

/**
 * Returns the current active focus area
 *
 * @returns {FocusArea|null} The current focus area or null if no focus is set
 */
export function getActiveFocus() {
  return activeFocus;
}

/**
 * Sets the active focus area and optionally adds related entity IDs to active context
 *
 * @param {FocusArea} focus - The focus area to set as active
 */
export function setActiveFocus(focus) {
  activeFocus = focus;

  // If focus has related entity IDs, add them to active context
  if (focus && Array.isArray(focus.related_entity_ids)) {
    updateActiveContext(focus.related_entity_ids, []);
  }
}

/**
 * Updates the active context by adding and removing entity IDs
 *
 * @param {string[]} addEntityIds - Array of entity IDs to add to active context
 * @param {string[]} removeEntityIds - Array of entity IDs to remove from active context
 */
export function updateActiveContext(addEntityIds = [], removeEntityIds = []) {
  const changeRecord = {
    timestamp: Date.now(),
  };

  // Add entities to active context
  if (addEntityIds.length > 0) {
    addEntityIds.forEach((id) => activeEntityIds.add(id));
    changeRecord.added = [...addEntityIds];
  }

  // Remove entities from active context
  if (removeEntityIds.length > 0) {
    removeEntityIds.forEach((id) => activeEntityIds.delete(id));
    changeRecord.removed = [...removeEntityIds];
  }

  // Record this change in history if anything changed
  if (addEntityIds.length > 0 || removeEntityIds.length > 0) {
    contextHistory.push(changeRecord);

    // Limit history size (keep last 50 changes)
    if (contextHistory.length > 50) {
      contextHistory.shift();
    }
  }
}

/**
 * Returns all entity IDs in the active context
 *
 * @returns {string[]} Array of active entity IDs
 */
export function getActiveContextEntityIds() {
  return [...activeEntityIds];
}

/**
 * Clears the active context by resetting all state variables
 */
export function clearActiveContext() {
  activeEntityIds.clear();
  activeFocus = null;

  // Record this change in history
  contextHistory.push({
    timestamp: Date.now(),
    event: "clear_context",
  });
}

/**
 * Returns the active context history
 * Used for debugging and analytics purposes
 *
 * @returns {Array} The context history array
 */
export function getContextHistory() {
  return [...contextHistory];
}

/**
 * Retrieves full entity details for all active context items from the database
 *
 * @returns {Promise<CodeEntity[]>} Array of code entity objects
 */
export async function getActiveContextAsEntities() {
  // Get current active entity IDs
  const entityIds = getActiveContextEntityIds();

  // If no active entities, return empty array
  if (entityIds.length === 0) {
    return [];
  }

  try {
    // Construct placeholders for SQL query
    const placeholders = entityIds.map(() => "?").join(",");

    // Construct and execute SQL query
    const query = `SELECT * FROM code_entities WHERE id IN (${placeholders})`;
    const entities = await executeQuery(query, entityIds);

    return entities;
  } catch (error) {
    console.error("Error retrieving active context entities:", error);
    // Return empty array in case of error
    return [];
  }
}

/**
 * Retrieves prioritized and compressed snippets of the active context
 *
 * @param {any} prioritizerLogic - Logic module for prioritizing context items
 * @param {any} compressorLogic - Logic module for compressing content
 * @param {any} db - Database access module
 * @param {number} tokenBudget - Maximum number of tokens to include
 * @param {string[]} [queryKeywords] - Optional keywords to prioritize content
 * @returns {Promise<Snippet[]>} Array of prioritized and compressed context snippets
 */
export async function getActiveContextAsSnippets(
  prioritizerLogic = ContextPrioritizerLogic,
  compressorLogic = ContextCompressorLogic,
  db = { executeQuery },
  tokenBudget = 2000,
  queryKeywords = []
) {
  try {
    // 1. Get active entities
    const activeEntities = await getActiveContextAsEntities();

    // 2. If no active entities, return empty array
    if (!activeEntities || activeEntities.length === 0) {
      return [];
    }

    // 3. Convert entities to ContextSnippet format for prioritization
    const contextSnippets = activeEntities.map((entity) => {
      // Get recency information from context history
      const recencyFactor = _calculateRecencyFactor(entity.id);

      return {
        entity_id: entity.id,
        content: entity.content,
        type: entity.type,
        path: entity.path,
        name: entity.name,
        baseRelevance: 0.5 + recencyFactor, // Base score plus recency boost
        metadata: {
          symbolPath: entity.symbol_path,
          parentId: entity.parent_id,
          version: entity.version,
        },
      };
    });

    // 4. Get current focus for prioritization
    const currentFocus = getActiveFocus();

    // 5. Prioritize the context snippets
    const prioritizedSnippets = await prioritizerLogic.prioritizeContexts(
      contextSnippets,
      queryKeywords,
      currentFocus,
      Math.max(50, activeEntities.length * 2) // Higher limit to prioritize from
    );

    // 6. Compress the prioritized snippets to fit within token budget
    const compressedSnippets = await compressorLogic.manageTokenBudget(
      prioritizedSnippets,
      tokenBudget,
      queryKeywords
    );

    // 7. Map the compressed snippets to the expected Snippet format
    return compressedSnippets.map((snippet) => ({
      entity_id: snippet.entity_id,
      summarizedContent: snippet.processedContent || snippet.content,
      originalScore: snippet.relevanceScore || snippet.baseRelevance,
      type: snippet.type,
    }));
  } catch (error) {
    console.error("Error generating context snippets:", error);
    return [];
  }
}

/**
 * Calculate a recency factor for an entity based on context history
 *
 * @private
 * @param {string} entityId - The entity ID to check
 * @returns {number} A recency factor between 0 and 0.5
 */
function _calculateRecencyFactor(entityId) {
  // Start from the most recent history entries
  for (let i = contextHistory.length - 1; i >= 0; i--) {
    const record = contextHistory[i];

    // If this entity was recently added, give it a boost
    if (record.added && record.added.includes(entityId)) {
      // Calculate how recent this addition was (0 = newest, 1 = oldest)
      const recencyIndex =
        (contextHistory.length - 1 - i) / contextHistory.length;
      // Convert to a score boost between 0.1 and 0.5 (newer = higher boost)
      return 0.5 - recencyIndex * 0.4;
    }
  }

  // Default recency factor if not found in history
  return 0.1;
}

/**
 * Returns a complete snapshot of the current active context state
 *
 * @returns {Promise<Object>} Object containing the current active context state
 */
export async function getActiveContextState() {
  try {
    // Get current active entities
    const entities = await getActiveContextAsEntities();

    // Get current focus
    const focus = getActiveFocus();

    // Get recent context history (last 10 changes)
    const recentHistory = contextHistory.slice(-10);

    // Create and return the context state
    return {
      activeEntityIds: [...activeEntityIds],
      activeFocus: focus,
      entities,
      recentChanges: recentHistory,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("Error getting active context state:", error);
    // Return basic state in case of error
    return {
      activeEntityIds: [...activeEntityIds],
      activeFocus: activeFocus,
      entities: [],
      recentChanges: [],
      timestamp: Date.now(),
      error: error.message,
    };
  }
}

/**
 * Updates the focus based on code changes
 *
 * @param {Array<{entityId: string, changeType: string, content: string}>} codeChanges - Array of code change objects
 * @returns {Promise<{updatedFocus: FocusArea|null, addedEntities: string[], removedEntities: string[]}>}
 */
export async function updateFocusWithCodeChanges(codeChanges) {
  try {
    if (
      !codeChanges ||
      !Array.isArray(codeChanges) ||
      codeChanges.length === 0
    ) {
      return {
        updatedFocus: activeFocus,
        addedEntities: [],
        removedEntities: [],
      };
    }

    // Track entities to add and remove
    const entitiesToAdd = new Set();
    const entitiesToRemove = new Set();

    // Process each code change
    for (const change of codeChanges) {
      const { entityId, changeType } = change;

      if (changeType === "delete") {
        // If entity is deleted, remove it from active context
        entitiesToRemove.add(entityId);
      } else {
        // For additions or modifications, add to active context
        entitiesToAdd.add(entityId);
      }
    }

    // Handle focus changes based on the most significant code change
    let updatedFocus = activeFocus;

    // If there are significant changes, potentially update the focus
    if (codeChanges.length > 0) {
      // Use the first changed file as a potential new focus
      // A more sophisticated implementation would analyze the changes
      // to determine the most important one
      const primaryChange = codeChanges[0];

      if (primaryChange.changeType !== "delete") {
        // Query for more info about this entity
        const query = `SELECT * FROM code_entities WHERE id = ?`;
        const entityResults = await executeQuery(query, [
          primaryChange.entityId,
        ]);

        if (entityResults.length > 0) {
          const entity = entityResults[0];

          // Determine whether to update focus
          const shouldUpdateFocus =
            // If no current focus
            !activeFocus ||
            // Or current focus is less specific than this entity
            (entity.type === "function" && activeFocus.focus_type === "file") ||
            // Or significant changes to the current focus
            (activeFocus.related_entity_ids &&
              activeFocus.related_entity_ids.includes(primaryChange.entityId) &&
              primaryChange.changeType === "modify");

          if (shouldUpdateFocus) {
            // Create a new focus area based on the changed entity
            updatedFocus = {
              focus_id: entity.id,
              focus_type: entity.type,
              identifier: entity.path || entity.name,
              description: `Focus on ${entity.type}: ${entity.name}`,
              related_entity_ids: [entity.id],
              keywords: [], // Would be filled with keywords from the entity
              last_activated_at: Date.now(),
              is_active: true,
            };

            // Update the active focus
            setActiveFocus(updatedFocus);
          }
        }
      }
    }

    // Update active context with added and removed entities
    const addedEntities = [...entitiesToAdd];
    const removedEntities = [...entitiesToRemove];

    // Don't add entities that are being removed
    const filteredAdded = addedEntities.filter(
      (id) => !entitiesToRemove.has(id)
    );

    // Update the active context
    updateActiveContext(filteredAdded, removedEntities);

    return {
      updatedFocus,
      addedEntities: filteredAdded,
      removedEntities,
    };
  } catch (error) {
    console.error("Error updating focus with code changes:", error);
    return {
      updatedFocus: activeFocus,
      addedEntities: [],
      removedEntities: [],
      error: error.message,
    };
  }
}
