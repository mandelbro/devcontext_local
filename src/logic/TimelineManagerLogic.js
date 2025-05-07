/**
 * TimelineManagerLogic.js
 *
 * Provides functions for managing and recording timeline events.
 */

import { v4 as uuidv4 } from "uuid";
import { executeQuery } from "../db.js";

/**
 * @typedef {Object} TimelineEvent
 * @property {string} event_id - Unique identifier for the event
 * @property {string} event_type - Type of event
 * @property {number} timestamp - Timestamp when the event occurred
 * @property {Object} data - Event data parsed from JSON
 * @property {string[]} associated_entity_ids - IDs of entities associated with this event
 * @property {string|null} conversation_id - Optional conversation ID this event belongs to
 * @property {string} created_at - Timestamp when the event was created in the database
 */

/**
 * @typedef {Object} Snapshot
 * @property {string} snapshot_id - Unique identifier for the snapshot
 * @property {string|null} name - Optional name of the snapshot
 * @property {string|null} description - Optional description of the snapshot
 * @property {Object} snapshot_data - Parsed snapshot data from JSON
 * @property {string|null} timeline_event_id - Optional ID of the associated timeline event
 * @property {string} created_at - Timestamp when the snapshot was created in the database
 */

/**
 * Records an event in the timeline
 *
 * @param {string} type - Type of event
 * @param {object} data - Event data object
 * @param {string[]} [associatedEntityIds=[]] - IDs of entities associated with this event
 * @param {string} [conversationId] - Optional conversation ID this event belongs to
 * @returns {Promise<string>} Generated event ID
 */
export async function recordEvent(
  type,
  data,
  associatedEntityIds = [],
  conversationId = null
) {
  try {
    // Generate a unique event ID
    const eventId = uuidv4();

    // Convert data and associatedEntityIds to JSON strings
    const dataJson = JSON.stringify(data);
    const entityIdsJson = JSON.stringify(associatedEntityIds);

    // Get current timestamp
    const timestamp = Date.now();

    // Construct the SQL query
    const query = `
      INSERT INTO timeline_events (
        event_id, 
        event_type, 
        timestamp, 
        data, 
        associated_entity_ids,
        conversation_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    // Execute the query with parameters
    await executeQuery(query, [
      eventId,
      type,
      timestamp,
      dataJson,
      entityIdsJson,
      conversationId,
    ]);

    return eventId;
  } catch (error) {
    console.error(`Error recording timeline event (${type}):`, error);
    throw error;
  }
}

/**
 * Creates a snapshot of the active context data
 *
 * @param {object} activeContextData - Data to be snapshotted (active entity IDs, focus, etc.)
 * @param {string} [name] - Optional name for the snapshot
 * @param {string} [description] - Optional description of the snapshot
 * @param {string} [timeline_event_id] - Optional ID of an associated timeline event
 * @returns {Promise<string>} Generated snapshot ID
 */
export async function createSnapshot(
  activeContextData,
  name = null,
  description = null,
  timeline_event_id = null
) {
  try {
    // Generate a unique snapshot ID
    const snapshot_id = uuidv4();

    // Convert activeContextData to a JSON string
    const snapshot_data = JSON.stringify(activeContextData);

    // Construct the SQL query
    const query = `
      INSERT INTO context_snapshots (
        snapshot_id,
        name,
        description,
        snapshot_data,
        timeline_event_id
      ) VALUES (?, ?, ?, ?, ?)
    `;

    // Execute the query with parameters
    await executeQuery(query, [
      snapshot_id,
      name,
      description,
      snapshot_data,
      timeline_event_id,
    ]);

    return snapshot_id;
  } catch (error) {
    console.error("Error creating context snapshot:", error);
    throw error;
  }
}

/**
 * Manages the creation of implicit checkpoints based on activity thresholds
 * This function checks for substantial activity and creates automatic snapshots when appropriate
 *
 * @returns {Promise<void>}
 */
export async function manageImplicitCheckpoints() {
  try {
    // Define activity thresholds
    const MIN_EVENTS_FOR_CHECKPOINT = 10;
    const MIN_MINUTES_SINCE_LAST_CHECKPOINT = 15;
    const SIGNIFICANT_EVENT_TYPES = [
      "code_change",
      "conversation_end",
      "focus_change",
    ];

    // Get the timestamp of the last implicit checkpoint
    const lastCheckpointQuery = `
      SELECT cs.snapshot_id, te.timestamp
      FROM context_snapshots cs
      LEFT JOIN timeline_events te ON cs.timeline_event_id = te.event_id
      WHERE (cs.name LIKE 'Implicit Checkpoint%' OR te.event_type = 'implicit_checkpoint_creation')
      ORDER BY te.timestamp DESC
      LIMIT 1
    `;

    const lastCheckpoint = await executeQuery(lastCheckpointQuery);
    const lastCheckpointTime =
      lastCheckpoint.rows && lastCheckpoint.rows.length > 0
        ? lastCheckpoint.rows[0].timestamp
        : 0;

    // Calculate time threshold
    const timeThreshold =
      Date.now() - MIN_MINUTES_SINCE_LAST_CHECKPOINT * 60 * 1000;

    // Check if enough time has passed since last checkpoint
    if (lastCheckpointTime > timeThreshold) {
      // Not enough time has passed
      return;
    }

    // Count events since last checkpoint
    const countEventsQuery = `
      SELECT COUNT(*) as event_count
      FROM timeline_events
      WHERE timestamp > ?
    `;

    const eventCountResult = await executeQuery(countEventsQuery, [
      lastCheckpointTime,
    ]);
    const eventCount =
      eventCountResult.rows && eventCountResult.rows.length > 0
        ? eventCountResult.rows[0].event_count || 0
        : 0;

    // Count significant events
    const significantEventsQuery = `
      SELECT COUNT(*) as significant_count
      FROM timeline_events
      WHERE timestamp > ? AND event_type IN (${SIGNIFICANT_EVENT_TYPES.map(
        () => "?"
      ).join(",")})
    `;

    const significantCountResult = await executeQuery(significantEventsQuery, [
      lastCheckpointTime,
      ...SIGNIFICANT_EVENT_TYPES,
    ]);
    const significantCount =
      significantCountResult.rows && significantCountResult.rows.length > 0
        ? significantCountResult.rows[0].significant_count || 0
        : 0;

    // Determine if we should create a checkpoint
    const shouldCreateCheckpoint =
      eventCount >= MIN_EVENTS_FOR_CHECKPOINT || significantCount > 0;

    if (shouldCreateCheckpoint) {
      // Get active context data
      // In a real implementation, this would come from ActiveContextManager
      // Since that's not available, we'll create mock data to demonstrate the function
      const activeContextData = {
        activeEntities: [], // This would be populated with actual entity IDs
        activeFocus: null, // This would be the current focus area
        timestamp: Date.now(),
      };

      // Try to get actual context data if available
      try {
        // This is a placeholder - in real implementation, we would check if
        // ActiveContextManager is available and use it to get context data
        const ActiveContextManager = global.ActiveContextManager;
        if (
          ActiveContextManager &&
          typeof ActiveContextManager.getActiveContextAsEntities === "function"
        ) {
          const contextData =
            await ActiveContextManager.getActiveContextAsEntities();
          if (contextData) {
            activeContextData.activeEntities = contextData.entities || [];
            activeContextData.activeFocus = contextData.focus || null;
          }
        }
      } catch (error) {
        console.warn(
          "Could not retrieve data from ActiveContextManager:",
          error.message
        );
        // Continue with mock data
      }

      // Generate checkpoint name and description
      const timestamp = new Date().toISOString();
      const checkpointName = `Implicit Checkpoint [${timestamp}]`;
      let description = "Automatically created checkpoint due to ";

      if (eventCount >= MIN_EVENTS_FOR_CHECKPOINT) {
        description += `high activity (${eventCount} events)`;
      } else if (significantCount > 0) {
        description += `significant changes (${significantCount} significant events)`;
      }

      // Record the checkpoint creation event
      const eventId = await recordEvent("implicit_checkpoint_creation", {
        reason: description,
        eventCount,
        significantCount,
      });

      // Create the snapshot
      await createSnapshot(
        activeContextData,
        checkpointName,
        description,
        eventId
      );
    }
  } catch (error) {
    console.error("Error managing implicit checkpoints:", error);
    // Don't throw - this function should not crash the application
  }
}

/**
 * Retrieves timeline events based on specified filters
 *
 * @param {Object} options - Query options
 * @param {string[]} [options.types] - Filter events by these event types
 * @param {number} [options.limit] - Maximum number of events to return
 * @param {string} [options.conversationId] - Filter events by this conversation ID
 * @param {boolean} [options.includeMilestones=true] - Whether to include milestone events
 * @param {string} [options.excludeConversationId] - Exclude events with this conversation ID
 * @returns {Promise<TimelineEvent[]>} Array of timeline events with parsed JSON fields
 */
export async function getEvents(options = {}) {
  try {
    const {
      types,
      limit,
      conversationId,
      includeMilestones = true,
      excludeConversationId,
    } = options;

    // Build the base query
    let query = "SELECT * FROM timeline_events WHERE 1=1";
    const params = [];

    // Apply filters based on options
    if (types && types.length > 0) {
      query += ` AND event_type IN (${types.map(() => "?").join(",")})`;
      params.push(...types);
    }

    if (conversationId) {
      query += " AND conversation_id = ?";
      params.push(conversationId);
    }

    if (excludeConversationId) {
      query += " AND (conversation_id != ? OR conversation_id IS NULL)";
      params.push(excludeConversationId);
    }

    // Handle milestone events filtering
    // Assuming milestone events have specific types like 'milestone_created' or are linked to snapshots
    if (!includeMilestones) {
      // Define the event types that are considered milestones
      const milestoneEventTypes = [
        "milestone_created",
        "implicit_checkpoint_creation",
        "checkpoint_created",
      ];
      query += ` AND event_type NOT IN (${milestoneEventTypes
        .map(() => "?")
        .join(",")})`;
      params.push(...milestoneEventTypes);

      // Additionally exclude events that have an associated snapshot
      query += ` AND NOT EXISTS (
        SELECT 1 FROM context_snapshots 
        WHERE context_snapshots.timeline_event_id = timeline_events.event_id
      )`;
    }

    // Add ordering
    query += " ORDER BY timestamp DESC";

    // Apply limit if specified
    if (limit && Number.isInteger(limit) && limit > 0) {
      query += " LIMIT ?";
      params.push(limit);
    }

    // Execute the query
    const events = await executeQuery(query, params);

    // Check if events has a rows property and it's an array
    const rows =
      events && events.rows && Array.isArray(events.rows)
        ? events.rows
        : Array.isArray(events)
        ? events
        : [];

    // If no valid results, return empty array
    if (rows.length === 0) {
      console.warn("No valid timeline events found");
      return [];
    }

    // Parse JSON fields in each event
    return rows.map((event) => ({
      ...event,
      data: JSON.parse(event.data || "{}"),
      associated_entity_ids: JSON.parse(event.associated_entity_ids || "[]"),
    }));
  } catch (error) {
    console.error("Error retrieving timeline events:", error);
    throw error;
  }
}

/**
 * Retrieves context snapshots (milestones) based on specified filters
 *
 * @param {Object} options - Query options
 * @param {string[]} [options.types] - Filter snapshots by type-related keywords in name or description
 * @param {number} [options.limit] - Maximum number of snapshots to return
 * @returns {Promise<Snapshot[]>} Array of context snapshots with parsed snapshot_data field
 */
export async function getMilestones(options = {}) {
  try {
    const { types, limit } = options;

    // Start building the query
    let query = `
      SELECT cs.*, te.event_type
      FROM context_snapshots cs
      LEFT JOIN timeline_events te ON cs.timeline_event_id = te.event_id
      WHERE 1=1
    `;

    const params = [];

    // Apply type filtering based on name, description or associated event type
    if (types && types.length > 0) {
      const typeConditions = [];

      for (const type of types) {
        // Create pattern for LIKE queries
        const pattern = `%${type}%`;

        // Add conditions for name, description and associated event type
        typeConditions.push("cs.name LIKE ?");
        params.push(pattern);

        typeConditions.push("cs.description LIKE ?");
        params.push(pattern);

        typeConditions.push("te.event_type LIKE ?");
        params.push(pattern);

        // Also search in event data if linked to a timeline event
        typeConditions.push(`
          EXISTS (
            SELECT 1 FROM timeline_events
            WHERE timeline_events.event_id = cs.timeline_event_id
            AND timeline_events.data LIKE ?
          )
        `);
        params.push(`%"category":"${type}"%`);
      }

      if (typeConditions.length > 0) {
        query += ` AND (${typeConditions.join(" OR ")})`;
      }
    }

    // Add ordering by timestamp (assuming cs.timestamp exists)
    query += " ORDER BY timestamp DESC";

    // Apply limit if specified
    if (limit && Number.isInteger(limit) && limit > 0) {
      query += " LIMIT ?";
      params.push(limit);
    }

    // Execute the query
    const snapshots = await executeQuery(query, params);

    // Check if snapshots has a rows property and it's an array
    const rows =
      snapshots && snapshots.rows && Array.isArray(snapshots.rows)
        ? snapshots.rows
        : Array.isArray(snapshots)
        ? snapshots
        : [];

    // If no valid results, return empty array
    if (rows.length === 0) {
      console.warn("No valid snapshots found");
      return [];
    }

    // Parse snapshot_data from JSON for each result
    return rows.map((snapshot) => ({
      ...snapshot,
      snapshot_data: JSON.parse(snapshot.snapshot_data || "{}"),
    }));
  } catch (error) {
    console.error("Error retrieving milestones:", error);
    throw error;
  }
}

/**
 * Gets recent events for a specific conversation
 *
 * @param {string} conversationId - The conversation ID
 * @param {number} [limit=10] - Maximum number of events to return
 * @param {string[]} [eventTypes] - Optional array of event types to filter by
 * @returns {Promise<TimelineEvent[]>} Array of timeline events
 */
export async function getRecentEventsForConversation(
  conversationId,
  limit = 10,
  eventTypes = null
) {
  try {
    if (!conversationId) {
      throw new Error("Conversation ID is required");
    }

    // Build the query
    let query = `
      SELECT 
        event_id,
        event_type,
        timestamp,
        data,
        associated_entity_ids,
        conversation_id
      FROM 
        timeline_events
      WHERE 
        conversation_id = ?
    `;

    const params = [conversationId];

    // Add event type filter if provided
    if (eventTypes && Array.isArray(eventTypes) && eventTypes.length > 0) {
      const placeholders = eventTypes.map(() => "?").join(",");
      query += ` AND event_type IN (${placeholders})`;
      params.push(...eventTypes);
    }

    // Add order and limit
    query += `
      ORDER BY 
        timestamp DESC
      LIMIT ?
    `;
    params.push(limit);

    // Execute the query
    const results = await executeQuery(query, params);

    // Check if results has a rows property and it's an array
    const rows =
      results && results.rows && Array.isArray(results.rows)
        ? results.rows
        : Array.isArray(results)
        ? results
        : [];

    // If no valid results, return empty array
    if (rows.length === 0) {
      console.warn("No recent events found for conversation:", conversationId);
      return [];
    }

    // Parse the JSON fields
    return rows.map((event) => ({
      ...event,
      data: JSON.parse(event.data || "{}"),
      associated_entity_ids: JSON.parse(event.associated_entity_ids || "[]"),
    }));
  } catch (error) {
    console.error(
      `Error getting recent events for conversation ${conversationId}:`,
      error
    );
    return [];
  }
}
