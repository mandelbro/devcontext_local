/**
 * A complex class implementation for testing importance score calculation.
 * This example should trigger higher importance scores due to complexity,
 * method count, and usage of conditional logic.
 */

/**
 * DataProcessor class handles various data transformation and analysis operations.
 * It provides functionality for filtering, mapping, reducing, and analyzing datasets.
 */
class DataProcessor {
  /**
   * Create a new DataProcessor
   * @param {Array} data - Initial dataset to process
   * @param {Object} options - Configuration options
   * @param {boolean} options.cacheResults - Whether to cache operation results
   * @param {number} options.precision - Decimal precision for numerical operations
   * @param {Function} options.logger - Custom logging function
   */
  constructor(data = [], options = {}) {
    this.data = Array.isArray(data) ? data : [];
    this.originalData = [...this.data];
    this.transformations = [];
    this.cache = new Map();
    this.options = {
      cacheResults: true,
      precision: 2,
      logger: console.log,
      ...options,
    };

    // Statistics
    this.stats = {
      operationCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lastOperationTime: null,
    };
  }

  /**
   * Reset data to its original state
   * @returns {DataProcessor} The processor instance for chaining
   */
  reset() {
    this.data = [...this.originalData];
    this.transformations = [];
    this._logOperation("reset");
    return this;
  }

  /**
   * Filter data based on provided predicate
   * @param {Function} predicate - Filter function
   * @returns {DataProcessor} The processor instance for chaining
   */
  filter(predicate) {
    if (typeof predicate !== "function") {
      throw new Error("Predicate must be a function");
    }

    const cacheKey = `filter_${predicate.toString()}`;

    if (this.options.cacheResults && this.cache.has(cacheKey)) {
      this.data = this.cache.get(cacheKey);
      this.stats.cacheHits++;
      this._logOperation("filter:cached");
      return this;
    }

    const startTime = performance.now();
    this.data = this.data.filter(predicate);
    const endTime = performance.now();

    this.transformations.push({
      type: "filter",
      predicate: predicate.toString(),
      timestamp: new Date().toISOString(),
      resultSize: this.data.length,
      executionTime: endTime - startTime,
    });

    if (this.options.cacheResults) {
      this.cache.set(cacheKey, [...this.data]);
      this.stats.cacheMisses++;
    }

    this._logOperation("filter");
    return this;
  }

  /**
   * Map data using the provided mapping function
   * @param {Function} mapper - Mapping function
   * @returns {DataProcessor} The processor instance for chaining
   */
  map(mapper) {
    if (typeof mapper !== "function") {
      throw new Error("Mapper must be a function");
    }

    const cacheKey = `map_${mapper.toString()}`;

    if (this.options.cacheResults && this.cache.has(cacheKey)) {
      this.data = this.cache.get(cacheKey);
      this.stats.cacheHits++;
      this._logOperation("map:cached");
      return this;
    }

    const startTime = performance.now();
    this.data = this.data.map(mapper);
    const endTime = performance.now();

    this.transformations.push({
      type: "map",
      mapper: mapper.toString(),
      timestamp: new Date().toISOString(),
      resultSize: this.data.length,
      executionTime: endTime - startTime,
    });

    if (this.options.cacheResults) {
      this.cache.set(cacheKey, [...this.data]);
      this.stats.cacheMisses++;
    }

    this._logOperation("map");
    return this;
  }

  /**
   * Sort data using the provided comparator function
   * @param {Function} comparator - Sorting comparator function
   * @returns {DataProcessor} The processor instance for chaining
   */
  sort(comparator) {
    const startTime = performance.now();
    this.data.sort(comparator);
    const endTime = performance.now();

    this.transformations.push({
      type: "sort",
      comparator: comparator ? comparator.toString() : "default",
      timestamp: new Date().toISOString(),
      resultSize: this.data.length,
      executionTime: endTime - startTime,
    });

    this._logOperation("sort");
    return this;
  }

  /**
   * Reduce data to a single value
   * @param {Function} reducer - Reducer function
   * @param {*} initialValue - Initial accumulator value
   * @returns {*} Reduced result
   */
  reduce(reducer, initialValue) {
    if (typeof reducer !== "function") {
      throw new Error("Reducer must be a function");
    }

    const startTime = performance.now();
    const result = this.data.reduce(reducer, initialValue);
    const endTime = performance.now();

    this.transformations.push({
      type: "reduce",
      reducer: reducer.toString(),
      initialValue:
        initialValue !== undefined ? String(initialValue) : "undefined",
      timestamp: new Date().toISOString(),
      executionTime: endTime - startTime,
    });

    this._logOperation("reduce");
    return result;
  }

  /**
   * Calculate statistical information about numeric data
   * @param {string} [property] - If data contains objects, property to analyze
   * @returns {Object} Statistical information
   */
  calculateStats(property) {
    const startTime = performance.now();

    // Extract numeric values to analyze
    let values;
    if (property && typeof property === "string") {
      values = this.data
        .map((item) => item[property])
        .filter((val) => typeof val === "number" && !isNaN(val));
    } else {
      values = this.data.filter(
        (val) => typeof val === "number" && !isNaN(val)
      );
    }

    // Calculate statistics
    const stats = {
      count: values.length,
      sum: 0,
      min: values.length ? values[0] : null,
      max: values.length ? values[0] : null,
      mean: 0,
      median: null,
      standardDeviation: null,
    };

    if (values.length === 0) {
      const endTime = performance.now();
      this._logOperation("calculateStats");
      return stats;
    }

    // Calculate sum, min, max
    for (const val of values) {
      stats.sum += val;
      if (val < stats.min) stats.min = val;
      if (val > stats.max) stats.max = val;
    }

    // Calculate mean
    stats.mean = stats.sum / values.length;

    // Calculate median
    const sortedValues = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sortedValues.length / 2);

    if (sortedValues.length % 2 === 0) {
      stats.median = (sortedValues[mid - 1] + sortedValues[mid]) / 2;
    } else {
      stats.median = sortedValues[mid];
    }

    // Calculate standard deviation
    let sumSquaredDiff = 0;
    for (const val of values) {
      sumSquaredDiff += Math.pow(val - stats.mean, 2);
    }
    stats.standardDeviation = Math.sqrt(sumSquaredDiff / values.length);

    // Round numbers to specified precision
    const precision = this.options.precision;
    stats.sum = Number(stats.sum.toFixed(precision));
    stats.mean = Number(stats.mean.toFixed(precision));
    stats.median = Number(stats.median.toFixed(precision));
    stats.standardDeviation = Number(
      stats.standardDeviation.toFixed(precision)
    );

    const endTime = performance.now();

    this.transformations.push({
      type: "calculateStats",
      property: property || "direct values",
      timestamp: new Date().toISOString(),
      executionTime: endTime - startTime,
    });

    this._logOperation("calculateStats");
    return stats;
  }

  /**
   * Group data by specific property
   * @param {string|Function} keySelector - Property name or key selector function
   * @returns {Object} Grouped data
   */
  groupBy(keySelector) {
    const startTime = performance.now();
    const grouped = {};

    const keyFn =
      typeof keySelector === "function"
        ? keySelector
        : (item) => item[keySelector];

    for (const item of this.data) {
      try {
        const key = keyFn(item);
        if (!grouped[key]) {
          grouped[key] = [];
        }
        grouped[key].push(item);
      } catch (error) {
        // Skip items that can't be grouped
        continue;
      }
    }

    const endTime = performance.now();

    this.transformations.push({
      type: "groupBy",
      keySelector: keySelector.toString(),
      timestamp: new Date().toISOString(),
      groupCount: Object.keys(grouped).length,
      executionTime: endTime - startTime,
    });

    this._logOperation("groupBy");
    return grouped;
  }

  /**
   * Get current state of the data
   * @returns {Array} Current data
   */
  getResult() {
    return [...this.data];
  }

  /**
   * Get all transformation history
   * @returns {Array} List of transformations applied
   */
  getTransformationHistory() {
    return [...this.transformations];
  }

  /**
   * Get processor statistics
   * @returns {Object} Statistics about processor usage
   */
  getStatistics() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      dataSize: this.data.length,
      transformationCount: this.transformations.length,
    };
  }

  /**
   * Clear the results cache
   * @returns {DataProcessor} The processor instance for chaining
   */
  clearCache() {
    this.cache.clear();
    this._logOperation("clearCache");
    return this;
  }

  /**
   * Log an operation for internal tracking
   * @private
   * @param {string} operationType - Type of operation performed
   */
  _logOperation(operationType) {
    this.stats.operationCount++;
    this.stats.lastOperationTime = new Date().toISOString();

    if (typeof this.options.logger === "function") {
      this.options.logger(
        `[DataProcessor] ${operationType} operation completed. ` +
          `Result size: ${this.data.length} items.`
      );
    }
  }
}

module.exports = DataProcessor;
