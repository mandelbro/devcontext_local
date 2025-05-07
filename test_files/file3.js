/**
 * Test file 3 for multiple code changes test
 */

class Logger {
  constructor(prefix = "") {
    this.prefix = prefix;
    this.logs = [];
  }

  log(message) {
    const formattedMessage = this.prefix
      ? `${this.prefix}: ${message}`
      : message;
    this.logs.push(formattedMessage);
    console.log(formattedMessage);
    return formattedMessage;
  }

  getLogs() {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
  }
}

module.exports = Logger;
