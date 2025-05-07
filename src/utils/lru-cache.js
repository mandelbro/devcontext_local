/**
 * Least Recently Used (LRU) Cache implementation
 * Provides efficient caching with automatic eviction of least recently used items
 */

import { MAX_CACHE_SIZE } from '../config.js';

/**
 * LRU Cache implementation using Map to track insertion order
 * When capacity is reached, the least recently used item is evicted
 */
export class LRUCache {
  /**
   * Creates a new LRU cache
   * @param {number} capacity - Maximum number of items the cache can hold
   */
  constructor(capacity = MAX_CACHE_SIZE) {
    this.capacity = capacity;
    // Using Map to maintain insertion order which helps with LRU tracking
    this.cache = new Map();
  }

  /**
   * Retrieves a value from the cache by key
   * If found, marks the item as most recently used
   * @param {string|number} key - The key to retrieve
   * @returns {*} The value associated with the key or null if not found
   */
  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }
    
    // Remove and re-add to make it the most recently used (moves to end of Map)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    
    return value;
  }

  /**
   * Adds or updates a key-value pair in the cache
   * If key exists, updates value and marks as most recently used
   * If cache is full, removes least recently used item before adding new one
   * @param {string|number} key - The key to add or update
   * @param {*} value - The value to associate with the key
   */
  put(key, value) {
    // If key exists, delete it first to update its position in the Map
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // If capacity is reached, remove the least recently used item (first in Map)
    else if (this.cache.size >= this.capacity) {
      // Get the first key in the Map (least recently used)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    // Add the new key-value pair (becomes most recently used)
    this.cache.set(key, value);
  }

  /**
   * Removes an item from the cache by key
   * @param {string|number} key - The key to remove
   * @returns {boolean} True if the key was found and removed, false otherwise
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Removes all items from the cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Returns the current number of items in the cache
   * @returns {number} Number of items currently in the cache
   */
  size() {
    return this.cache.size;
  }

  /**
   * Checks if a key exists in the cache
   * @param {string|number} key - The key to check
   * @returns {boolean} True if the key exists, false otherwise
   */
  has(key) {
    return this.cache.has(key);
  }
}

export default LRUCache;
