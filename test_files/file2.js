/**
 * Test file 2 for multiple code changes test
 */

function calculate(a, b, operation) {
  switch (operation) {
    case "add":
      return a + b;
    case "subtract":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
      return a / b;
    default:
      throw new Error("Invalid operation");
  }
}

module.exports = {
  calculate,
};
