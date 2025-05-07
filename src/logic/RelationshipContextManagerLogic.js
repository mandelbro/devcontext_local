/**
 * RelationshipContextManagerLogic.js
 *
 * Provides functions for managing relationships between code entities.
 */

import { v4 as uuidv4 } from "uuid";
import { executeQuery } from "../db.js";

/**
 * Adds a relationship between two code entities
 *
 * @param {string} sourceEntityId - ID of the source entity
 * @param {string} targetEntityId - ID of the target entity
 * @param {string} relationshipType - Type of relationship (e.g., 'calls', 'imports', 'extends')
 * @param {number} weight - Weight of the relationship (default: 1.0)
 * @param {object} metadata - Additional metadata about the relationship
 * @returns {Promise<void>}
 */
export async function addRelationship(
  sourceEntityId,
  targetEntityId,
  relationshipType,
  weight = 1.0,
  metadata = {}
) {
  // Validate required parameters
  if (!sourceEntityId || !targetEntityId || !relationshipType) {
    throw new Error(
      "Source entity ID, target entity ID, and relationship type are required"
    );
  }

  // Generate a new UUID for the relationship
  const relationshipId = uuidv4();

  // Convert metadata object to JSON string
  const metadataJson = JSON.stringify(metadata);

  try {
    // Insert the relationship into the database
    const query = `
      INSERT INTO code_relationships (
        relationship_id, source_entity_id, target_entity_id, relationship_type, weight, metadata
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    await executeQuery(query, [
      relationshipId,
      sourceEntityId,
      targetEntityId,
      relationshipType,
      weight,
      metadataJson,
    ]);
  } catch (error) {
    // Check if error is due to unique constraint violation
    if (error.message && error.message.includes("UNIQUE constraint failed")) {
      // If duplicate, we'll update the existing relationship
      const updateQuery = `
        UPDATE code_relationships 
        SET weight = ?, metadata = ? 
        WHERE source_entity_id = ? AND target_entity_id = ? AND relationship_type = ?
      `;

      await executeQuery(updateQuery, [
        weight,
        metadataJson,
        sourceEntityId,
        targetEntityId,
        relationshipType,
      ]);
    } else {
      // For other errors, rethrow
      console.error(
        `Error adding relationship between ${sourceEntityId} and ${targetEntityId}:`,
        error
      );
      throw error;
    }
  }
}

/**
 * Relationship type definition matching code_relationships table structure
 * @typedef {Object} Relationship
 * @property {string} relationship_id - Unique identifier for the relationship
 * @property {string} source_entity_id - ID of the source entity
 * @property {string} target_entity_id - ID of the target entity
 * @property {string} relationship_type - Type of relationship
 * @property {number} weight - Weight of the relationship
 * @property {Object} metadata - Additional metadata about the relationship
 */

/**
 * Gets relationships for a specific entity
 *
 * @param {string} entityId - ID of the entity to get relationships for
 * @param {string} direction - Direction of relationships to get ('outgoing', 'incoming', or 'both')
 * @param {string[]} types - Types of relationships to filter by (empty array for all types)
 * @returns {Promise<Relationship[]>} Array of relationship objects
 */
export async function getRelationships(
  entityId,
  direction = "outgoing",
  types = []
) {
  // Validate required parameters
  if (!entityId) {
    throw new Error("Entity ID is required");
  }

  // Validate direction parameter
  if (!["outgoing", "incoming", "both"].includes(direction)) {
    throw new Error("Direction must be 'outgoing', 'incoming', or 'both'");
  }

  // Build the base query
  let query = `
    SELECT 
      relationship_id, 
      source_entity_id, 
      target_entity_id, 
      relationship_type, 
      weight, 
      metadata
    FROM code_relationships
    WHERE 
  `;

  const queryParams = [];

  // Add direction-specific conditions
  if (direction === "outgoing") {
    query += "source_entity_id = ?";
    queryParams.push(entityId);
  } else if (direction === "incoming") {
    query += "target_entity_id = ?";
    queryParams.push(entityId);
  } else {
    // direction === "both"
    query += "(source_entity_id = ? OR target_entity_id = ?)";
    queryParams.push(entityId, entityId);
  }

  // Add relationship type filter if provided
  if (types.length > 0) {
    // Create placeholders for the IN clause
    const typePlaceholders = types.map(() => "?").join(", ");
    query += ` AND relationship_type IN (${typePlaceholders})`;
    queryParams.push(...types);
  }

  try {
    // Execute the query
    const relationships = await executeQuery(query, queryParams);

    // Process metadata for each relationship
    return relationships.map((relationship) => ({
      ...relationship,
      // Parse metadata JSON string to object, default to empty object if null or invalid
      metadata: relationship.metadata ? JSON.parse(relationship.metadata) : {},
    }));
  } catch (error) {
    console.error(`Error getting relationships for entity ${entityId}:`, error);
    throw error;
  }
}

/**
 * GraphSnippet type definition for call graph data
 * @typedef {Object} GraphSnippet
 * @property {Array<{id: string, name: string, type: string}>} nodes - Entities in the graph
 * @property {Array<{source: string, target: string, type: string}>} edges - Relationships between entities
 */

/**
 * Builds a call graph snippet starting from a function entity
 *
 * @param {string} functionEntityId - ID of the function entity to start from
 * @param {number} depth - Maximum depth of the call graph (default: 2)
 * @returns {Promise<GraphSnippet>} Call graph snippet with nodes and edges
 */
export async function buildCallGraphSnippet(functionEntityId, depth = 2) {
  // Validate required parameters
  if (!functionEntityId) {
    throw new Error("Function entity ID is required");
  }

  // Validate depth
  if (depth < 1) {
    throw new Error("Depth must be at least 1");
  }

  try {
    // Use a recursive Common Table Expression (CTE) to get function calls up to specified depth
    const outgoingCallsQuery = `
      WITH RECURSIVE call_graph AS (
        -- Base case: start with the source function
        SELECT 
          cr.source_entity_id, 
          cr.target_entity_id, 
          cr.relationship_type,
          0 AS depth
        FROM code_relationships cr
        WHERE cr.source_entity_id = ? 
          AND cr.relationship_type = 'calls'
        
        UNION ALL
        
        -- Recursive case: find further calls up to max depth
        SELECT 
          cr.source_entity_id, 
          cr.target_entity_id, 
          cr.relationship_type,
          cg.depth + 1 AS depth
        FROM code_relationships cr
        JOIN call_graph cg ON cr.source_entity_id = cg.target_entity_id
        WHERE cr.relationship_type = 'calls'
          AND cg.depth < ?
      )
      SELECT DISTINCT source_entity_id, target_entity_id, relationship_type, depth
      FROM call_graph
      ORDER BY depth
    `;

    const outgoingCalls = await executeQuery(outgoingCallsQuery, [
      functionEntityId,
      depth - 1,
    ]);

    // Get incoming calls (functions that call our target function)
    const incomingCallsQuery = `
      SELECT 
        cr.source_entity_id, 
        cr.target_entity_id, 
        cr.relationship_type,
        0 AS depth
      FROM code_relationships cr
      WHERE cr.target_entity_id = ? 
        AND cr.relationship_type = 'calls'
    `;

    const incomingCalls = await executeQuery(incomingCallsQuery, [
      functionEntityId,
    ]);

    // Combine outgoing and incoming calls
    const allCalls = [...outgoingCalls, ...incomingCalls];

    // Extract all unique entity IDs involved
    const entityIds = new Set();
    entityIds.add(functionEntityId); // Add the root function

    allCalls.forEach((call) => {
      entityIds.add(call.source_entity_id);
      entityIds.add(call.target_entity_id);
    });

    // Get entity details for all involved entities
    const entityIdsArray = Array.from(entityIds);
    const placeholders = entityIdsArray.map(() => "?").join(",");

    const entitiesQuery = `
      SELECT 
        id, 
        name, 
        type
      FROM code_entities
      WHERE id IN (${placeholders})
    `;

    const entities = await executeQuery(entitiesQuery, entityIdsArray);

    // Build the graph nodes
    const nodes = entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
    }));

    // Build the graph edges
    const edges = allCalls.map((call) => ({
      source: call.source_entity_id,
      target: call.target_entity_id,
      type: call.relationship_type,
    }));

    // Return the call graph snippet
    return {
      nodes,
      edges,
    };
  } catch (error) {
    console.error(
      `Error building call graph for function ${functionEntityId}:`,
      error
    );
    throw error;
  }
}

/**
 * Path type definition for code paths
 * @typedef {string[]} Path - An array of entity IDs representing a path
 */

/**
 * Finds all paths between two entities with a specific relationship type
 *
 * @param {string} startEntityId - ID of the starting entity
 * @param {string} endEntityId - ID of the ending entity
 * @param {string} relationshipType - Type of relationship to follow
 * @returns {Promise<Path[]>} Array of paths (each path is an array of entity IDs)
 */
export async function findCodePaths(
  startEntityId,
  endEntityId,
  relationshipType
) {
  // Validate required parameters
  if (!startEntityId || !endEntityId || !relationshipType) {
    throw new Error(
      "Start entity ID, end entity ID, and relationship type are required"
    );
  }

  try {
    // Use a recursive CTE to find all paths
    const query = `
      WITH RECURSIVE paths(path, current_id, visited) AS (
        -- Base case: start with the starting entity
        SELECT 
          startEntityId || '', -- Initialize path with just the start entity
          startEntityId,
          startEntityId -- Initialize visited set with start entity
        FROM (SELECT ? AS startEntityId)
        
        UNION ALL
        
        -- Recursive case: extend paths that haven't reached the end entity
        SELECT
          paths.path || ',' || cr.target_entity_id, -- Append target to path
          cr.target_entity_id, -- New current entity is the target
          paths.visited || ',' || cr.target_entity_id -- Update visited set
        FROM
          code_relationships cr
        JOIN
          paths ON cr.source_entity_id = paths.current_id
        WHERE
          cr.relationship_type = ?
          AND cr.target_entity_id != paths.startEntityId -- Avoid immediate cycles back to start
          AND paths.visited NOT LIKE '%,' || cr.target_entity_id || ',%' -- Check for cycles
          AND paths.visited NOT LIKE cr.target_entity_id || ',%' -- Check for cycles at start
          AND paths.visited NOT LIKE '%,' || cr.target_entity_id -- Check for cycles at end
      )
      -- Select paths that end at the target entity
      SELECT path
      FROM paths
      WHERE current_id = ?
    `;

    const results = await executeQuery(query, [
      startEntityId,
      relationshipType,
      endEntityId,
    ]);

    // Process the results into an array of paths
    return results.map((row) => {
      // Split the path string into an array of entity IDs
      return row.path.split(",");
    });
  } catch (error) {
    console.error(
      `Error finding paths between ${startEntityId} and ${endEntityId}:`,
      error
    );

    // SQLite might not fully support the recursive CTE with the cycle detection as written
    // If we get an error, let's use a more basic approach that has limited depth

    try {
      // Fallback to a simpler implementation with finite depth
      const maxDepth = 10; // Reasonable limit to prevent excessive path lengths

      const fallbackQuery = `
        WITH RECURSIVE paths(path, current_id, depth) AS (
          -- Base case: start with the starting entity
          SELECT 
            ? AS path,
            ? AS current_id,
            0 AS depth
          
          UNION ALL
          
          -- Recursive case: extend paths that haven't reached the end entity
          SELECT
            paths.path || ',' || cr.target_entity_id,
            cr.target_entity_id,
            paths.depth + 1
          FROM
            code_relationships cr
          JOIN
            paths ON cr.source_entity_id = paths.current_id
          WHERE
            cr.relationship_type = ?
            AND paths.depth < ?
            AND paths.path NOT LIKE '%' || cr.target_entity_id || '%' -- Simple cycle check
        )
        -- Select paths that end at the target entity
        SELECT path
        FROM paths
        WHERE current_id = ?
      `;

      const fallbackResults = await executeQuery(fallbackQuery, [
        startEntityId,
        startEntityId,
        relationshipType,
        maxDepth,
        endEntityId,
      ]);

      // Process the fallback results
      return fallbackResults.map((row) => {
        return row.path.split(",");
      });
    } catch (fallbackError) {
      console.error(
        "Fallback path finding approach also failed:",
        fallbackError
      );

      // If all else fails, return an empty array
      return [];
    }
  }
}

/**
 * Gets entities related to a given entity
 *
 * @param {string} entityId - ID of the entity to get related entities for
 * @param {string[]} [relationshipTypes=[]] - Types of relationships to filter by (empty array for all types)
 * @param {number} [maxResults=20] - Maximum number of results to return
 * @returns {Promise<string[]>} Array of related entity IDs
 */
export async function getRelatedEntities(
  entityId,
  relationshipTypes = [],
  maxResults = 20
) {
  // Validate required parameters
  if (!entityId) {
    throw new Error("Entity ID is required");
  }

  try {
    // Get both incoming and outgoing relationships
    const relationships = await getRelationships(
      entityId,
      "both",
      relationshipTypes
    );

    // Extract unique entity IDs from relationships
    const relatedEntityIds = new Set();

    for (const relationship of relationships) {
      if (relationship.source_entity_id === entityId) {
        relatedEntityIds.add(relationship.target_entity_id);
      } else {
        relatedEntityIds.add(relationship.source_entity_id);
      }

      // Stop if we've reached the maximum number of results
      if (relatedEntityIds.size >= maxResults) {
        break;
      }
    }

    return Array.from(relatedEntityIds);
  } catch (error) {
    console.error(`Error getting related entities for ${entityId}:`, error);
    return [];
  }
}
