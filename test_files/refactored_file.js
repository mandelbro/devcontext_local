/**
 * Refactored version of the simple_function.js file.
 * Same functionality but with different structure and coding style.
 * This helps test how the indexing system handles refactoring.
 */

// Using arrow functions instead of traditional function declarations
// Also using different naming and organization

/**
 * Mathematical operations module with basic arithmetic functions
 */
const mathOperations = {
  /**
   * Sum two numeric values
   * @param {number} x - First operand
   * @param {number} y - Second operand
   * @returns {number} The sum of x and y
   */
  sum: (x, y) => x + y,

  /**
   * Difference between two numeric values
   * @param {number} x - First operand
   * @param {number} y - Second operand (to subtract)
   * @returns {number} The difference (x - y)
   */
  difference: (x, y) => x - y,
};

// Additional utility functions that weren't in the original
/**
 * Multiply two numbers
 * @param {number} x - First operand
 * @param {number} y - Second operand
 * @returns {number} Product of x and y
 */
const multiply = (x, y) => x * y;

/**
 * Create a function that applies a specific math operation
 * @param {string} operation - Name of operation ('sum', 'difference', or 'multiply')
 * @returns {Function} Function that performs the specified operation
 */
const createMathFunction = (operation) => {
  switch (operation) {
    case "sum":
      return mathOperations.sum;
    case "difference":
      return mathOperations.difference;
    case "multiply":
      return multiply;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
};

// Export with different names than the original
module.exports = {
  addition: mathOperations.sum,
  subtraction: mathOperations.difference,
  multiplication: multiply,
  createOperation: createMathFunction,
};
