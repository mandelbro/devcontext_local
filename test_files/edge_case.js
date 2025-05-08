/**
 * =========================================================================
 * █████████████████████████████████████████████████████████████████████████
 * █ ███ █ ███ █████ ███ █ █ █ ███ █ ███ █ ███ █████ ███ █ █ █ ███ █ ███ █
 * █ ███ █ ███ █████ ███ █ █ █ ███ █ ███ █ ███ █████ ███ █ █ █ ███ █ ███ █
 * █████████████████████████████████████████████████████████████████████████
 *
 * EDGE CASE TEST FILE WITH UNUSUAL FORMATTING AND COMPLICATED COMMENTS
 * This file tests the system's ability to handle edge cases in parsing,
 * summarization, and importance scoring.
 * =========================================================================
 */

/******************************************************************************
 * @summary This function has a very complex multi-line comment that spans
 * multiple lines and contains various characters like:
 * ##################################################################
 *
 * @complexity O(1) - Constant time
 * @author Test System <test@example.com>
 * @since v1.0.0
 * @see Related documentation: {@link https://example.com/docs}
 * @example
 * ```js
 * // Example usage:
 * const result = verySpecialFunction("test");
 * console.log(result); // Outputs: "TEST"
 * ```
 *
 * Unicode examples: 你好, Привет, مرحبا, こんにちは
 ******************************************************************************/
function verySpecialFunction(input /* inline comment */) {
  /* This comment is in the middle of the function */
  return input.toString().toUpperCase(); // Convert to uppercase
} // End of function

/* eslint-disable no-console */
// Unusual variable naming
const $_unusualVarName_12345 = {
  "key-with-hyphens": true,
  nested: {
    $: {
      deeply: {
        nested: {
          property: "value",
        },
      },
    },
  },
};
/* eslint-enable */

/**
 * A class with unconventional formatting and special comments
 * @class
 */
class UnusuallyFormattedClass {
  /**
   * Constructor with weird indentation
   */
  constructor() {
    this.property = "value";

    this.methods = {
      one: () => 1,
      two: () => 2,
    };
  }

  /* @TODO: Fix this later */ unusualMethodName(
    /* Parameter 1 */ param1,
    /* Parameter 2 */

    param2
  ) {
    const result = !param1
      ? param2.split("").reverse().join("")
      : param1.toUpperCase() + param2.toLowerCase();

    console /* Comment in the middle of identifier */
      .log(result);

    return result;
  }
}

// IIFE with multiple nested functions
(function complexIIFE() {
  function nestedFunction1() {
    return function nestedFunction2() {
      return function nestedFunction3() {
        return function nestedFunction4() {
          return "Too many nested functions!";
        };
      };
    };
  }

  return nestedFunction1()()()();
})();

// Function with default parameters, rest parameters, and destructuring
const complexParameters = (
  { prop1 = "default1", prop2: { nestedProp = "default2" } = {} } = {},
  ...restArgs
) => {
  // Using template literals with expressions
  return `${prop1} ${nestedProp} ${restArgs.join(" ")}`;
};

// Export everything with a special form
module.exports =
  /* This is a strange place for a comment */
  {
    verySpecialFunction,
    $_unusualVarName_12345,
    UnusuallyFormattedClass,
    complexParameters,
  };

// Region blocks that some IDEs use
// #region Special Region
function insideRegion() {
  return "This function is inside a region block";
}
// #endregion

/*
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║                                                                       ║
 * ║                          END OF FILE                                  ║
 * ║                                                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 */
