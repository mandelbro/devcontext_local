/**
 * TextTokenizerLogic.js
 *
 * Provides text tokenization with language-specific enhancements
 * for more accurate code analysis and context understanding.
 */

/**
 * Tokenizes input text with language-specific tokenization rules
 *
 * @param {string} text - The text to tokenize
 * @param {string} language - The programming language of the text (default: 'plaintext')
 * @returns {string[]} An array of tokens
 */
export function tokenize(text, language = "plaintext") {
  // Normalize to lowercase as requested
  const normalizedText = text.toLowerCase();

  // Handle language-specific tokenization based on the language parameter
  switch (language) {
    case "javascript":
    case "typescript":
    case "jsx":
    case "tsx":
      return tokenizeJavaScript(normalizedText);
    case "python":
      return tokenizePython(normalizedText);
    case "java":
    case "csharp":
    case "c#":
      return tokenizeJavaLike(normalizedText);
    case "ruby":
      return tokenizeRuby(normalizedText);
    case "go":
      return tokenizeGo(normalizedText);
    case "plaintext":
    default:
      return tokenizeGeneric(normalizedText);
  }
}

/**
 * Generates n-grams from an array of tokens, respecting semantic boundaries where possible
 *
 * @param {string[]} tokens - Array of tokens (from tokenize function)
 * @param {number} n - Size of n-grams to generate (e.g., 2 for bigrams, 3 for trigrams)
 * @returns {string[]} Array of n-gram strings
 */
export function generateNgrams(tokens, n) {
  // Handle edge cases
  if (!tokens || tokens.length === 0) return [];
  if (n <= 0) return [];
  if (tokens.length < n) return [tokens.join(" ")];

  const ngrams = [];

  // Track positions where we should avoid generating n-grams
  // These represent semantic boundaries
  const semanticBoundaries = new Set();

  // Identify potential semantic boundaries
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Break at special tokens that indicate syntactic boundaries
    if (token.startsWith("__") && token.endsWith("__")) {
      semanticBoundaries.add(i);
      semanticBoundaries.add(i + 1);
    }

    // Break at common punctuation that signals the end of statements
    if ([";", ".", "{", "}", "(", ")", "[", "]"].includes(token)) {
      semanticBoundaries.add(i);
      semanticBoundaries.add(i + 1);
    }
  }

  // Generate n-grams by sliding a window of size n over the tokens array
  // Skip windows that cross semantic boundaries
  for (let i = 0; i <= tokens.length - n; i++) {
    // Check if any semantic boundary exists within this window
    let hasBoundary = false;
    for (let j = i; j < i + n - 1; j++) {
      if (semanticBoundaries.has(j + 1)) {
        hasBoundary = true;
        break;
      }
    }

    // If no semantic boundaries in this window, generate the n-gram
    if (!hasBoundary) {
      const ngram = tokens.slice(i, i + n).join(" ");
      ngrams.push(ngram);
    }
  }

  return ngrams;
}

/**
 * Extracts n-grams from an array of tokens (alias for generateNgrams)
 *
 * @param {string[]} tokens - Array of tokens (from tokenize function)
 * @param {number} n - Size of n-grams to generate (e.g., 2 for bigrams, 3 for trigrams)
 * @returns {string[]} Array of n-gram strings
 */
export function extractNGrams(tokens, n) {
  return generateNgrams(tokens, n);
}

/**
 * Identifies language-specific idioms in code text
 *
 * @param {string} text - Raw text to analyze
 * @param {string} language - Programming language of the text
 * @returns {{idiom: string, type: string, location: {start: number, end: number}}[]} Array of identified idioms
 */
export function identifyLanguageSpecificIdioms(text, language) {
  // Handle empty input
  if (!text) return [];

  const idioms = [];

  // Normalize language parameter
  const normalizedLanguage = language.toLowerCase();

  // Use language-specific idiom detection
  switch (normalizedLanguage) {
    case "javascript":
    case "typescript":
    case "jsx":
    case "tsx":
      identifyJavaScriptIdioms(text, idioms);
      break;
    case "python":
      identifyPythonIdioms(text, idioms);
      break;
    case "csharp":
    case "c#":
      identifyCSharpIdioms(text, idioms);
      break;
    // Add more languages as needed
  }

  return idioms;
}

/**
 * Identifies JavaScript-specific idioms
 *
 * @param {string} text - JavaScript code text
 * @param {Array} idioms - Array to add identified idioms to
 * @private
 */
function identifyJavaScriptIdioms(text, idioms) {
  // 1. Detect Promise chains (.then().catch())
  const promiseChainRegex =
    /\.\s*then\s*\(\s*(?:function\s*\([^)]*\)|[^=>(]*=>\s*[^)]*)\s*\)(?:\s*\.(?:then|catch|finally)\s*\([^)]*\))+/g;
  let match;

  while ((match = promiseChainRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "js_promise_chain",
      location: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  // 2. Detect async/await usage
  const asyncAwaitRegex =
    /\basync\s+(?:function\s*[a-zA-Z0-9_$]*\s*\([^)]*\)|(?:[a-zA-Z0-9_$]+\s*=>)|(?:\([^)]*\)\s*=>))(?:(?:.|\n)*?\bawait\b(?:.|\n)*?)/g;

  while ((match = asyncAwaitRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "js_async_await",
      location: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  // 3. Detect arrow functions as callbacks
  const arrowCallbackRegex =
    /(?:\.|\()(?:[a-zA-Z0-9_$]+)?\s*\(\s*(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>\s*(?:{[^}]*}|[^);,]*)/g;

  while ((match = arrowCallbackRegex.exec(text)) !== null) {
    // Avoid duplicate detection with Promise chains
    const isDuplicate = idioms.some(
      (idiom) =>
        idiom.type === "js_promise_chain" &&
        match.index >= idiom.location.start &&
        match.index + match[0].length <= idiom.location.end
    );

    if (!isDuplicate) {
      idioms.push({
        idiom: match[0],
        type: "js_arrow_callback",
        location: {
          start: match.index,
          end: match.index + match[0].length,
        },
      });
    }
  }
}

/**
 * Identifies Python-specific idioms
 *
 * @param {string} text - Python code text
 * @param {Array} idioms - Array to add identified idioms to
 * @private
 */
function identifyPythonIdioms(text, idioms) {
  // 1. Detect list comprehensions
  const listComprehensionRegex =
    /\[\s*[^\[\]]*\s+for\s+[^\[\]]+\s+in\s+[^\[\]]+(?:\s+if\s+[^\[\]]+)?\s*\]/g;
  let match;

  while ((match = listComprehensionRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "python_list_comprehension",
      location: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  // 2. Detect dictionary comprehensions
  const dictComprehensionRegex =
    /\{\s*[^{}]*\s*:\s*[^{}]*\s+for\s+[^{}]+\s+in\s+[^{}]+(?:\s+if\s+[^{}]+)?\s*\}/g;

  while ((match = dictComprehensionRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "python_dict_comprehension",
      location: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  // 3. Detect lambda functions
  const lambdaRegex = /lambda\s+[^:]+:[^,\n)]+/g;

  while ((match = lambdaRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "python_lambda",
      location: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  // 4. Detect generator expressions
  const generatorRegex =
    /\(\s*[^()]*\s+for\s+[^()]+\s+in\s+[^()]+(?:\s+if\s+[^()]+)?\s*\)/g;

  while ((match = generatorRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "python_generator_expression",
      location: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }
}

/**
 * Identifies C#-specific idioms
 *
 * @param {string} text - C# code text
 * @param {Array} idioms - Array to add identified idioms to
 * @private
 */
function identifyCSharpIdioms(text, idioms) {
  // 1. Detect LINQ queries with method syntax
  const linqMethodRegex =
    /\.\s*(?:Where|Select|OrderBy|OrderByDescending|GroupBy|Join|Skip|Take|First|FirstOrDefault|Any|All|Count)\s*\(\s*[^)]*\)(?:\s*\.\s*(?:Where|Select|OrderBy|OrderByDescending|GroupBy|Join|Skip|Take|First|FirstOrDefault|Any|All|Count)\s*\(\s*[^)]*\))*/g;
  let match;

  while ((match = linqMethodRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "csharp_linq_method",
      location: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  // 2. Detect LINQ queries with query syntax
  const linqQueryRegex =
    /from\s+\w+\s+in\s+[^{]+(?:where\s+[^{]+)?(?:orderby\s+[^{]+)?(?:select\s+[^{;]+)?(?:group\s+[^{;]+by\s+[^{;]+)?/g;

  while ((match = linqQueryRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "csharp_linq_query",
      location: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  // 3. Detect async/await patterns
  const asyncAwaitRegex =
    /\basync\s+[^(]*\([^)]*\)(?:\s*<[^>]*>)?\s*(?:=>)?\s*{(?:(?:.|\n)*?\bawait\b(?:.|\n)*?)}/g;

  while ((match = asyncAwaitRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "csharp_async_await",
      location: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
  }

  // 4. Detect lambda expressions
  const lambdaRegex = /(?:\([^)]*\)|\w+)\s*=>\s*(?:{[^}]*}|[^;]+)/g;

  while ((match = lambdaRegex.exec(text)) !== null) {
    // Avoid duplicate detection with LINQ methods
    const isDuplicate = idioms.some(
      (idiom) =>
        (idiom.type === "csharp_linq_method" ||
          idiom.type === "csharp_linq_query") &&
        match.index >= idiom.location.start &&
        match.index + match[0].length <= idiom.location.end
    );

    if (!isDuplicate) {
      idioms.push({
        idiom: match[0],
        type: "csharp_lambda",
        location: {
          start: match.index,
          end: match.index + match[0].length,
        },
      });
    }
  }
}

/**
 * Extracts keywords from an array of tokens with language-specific enhancements
 *
 * @param {string[]} tokens - Array of tokens (from tokenize function)
 * @param {number} topN - Number of top keywords to return (default: 10)
 * @param {string} language - Programming language hint (default: 'plaintext')
 * @returns {{keyword: string, score: number}[]} Array of keywords with scores
 */
export function extractKeywords(tokens, topN = 10, language = "plaintext") {
  // Get language-specific stop words
  const stopWords = getStopWords(language);

  // Calculate term frequencies
  const termFrequencies = {};
  for (const token of tokens) {
    if (!termFrequencies[token]) {
      termFrequencies[token] = 0;
    }
    termFrequencies[token]++;
  }

  // Apply scoring heuristics
  const scoredKeywords = [];

  for (const [token, frequency] of Object.entries(termFrequencies)) {
    // Skip stop words unless they're part of something significant
    // (e.g., longer than typical stop words or contain special characters)
    if (stopWords.has(token) && token.length < 6 && !/[_\-$#@]/.test(token)) {
      continue;
    }

    // Base score is the term frequency
    let score = frequency;

    // Boost domain-specific tokens (identifiers)
    if (isDomainSpecificToken(token, language)) {
      score *= 2.0;
    }

    // Boost longer words (they tend to be more meaningful)
    if (token.length > 6) {
      score *= 1.5;
    }

    // Boost tokens with special characters that are likely important in code
    if (/[_$]/.test(token)) {
      score *= 1.2;
    }

    // Penalize very short tokens that aren't likely to be meaningful
    if (token.length < 3 && !/[_\-$#@]/.test(token)) {
      score *= 0.5;
    }

    // Additional boosts for language-specific patterns
    score = applyLanguageSpecificBoosts(token, score, language);

    scoredKeywords.push({
      keyword: token,
      score: score,
    });
  }

  // Sort by score (descending) and return top N
  return scoredKeywords.sort((a, b) => b.score - a.score).slice(0, topN);
}

/**
 * Determines if a token is likely a domain-specific identifier
 *
 * @param {string} token - The token to check
 * @param {string} language - The programming language
 * @returns {boolean} True if the token appears to be domain-specific
 */
function isDomainSpecificToken(token, language) {
  // Check for common patterns that indicate domain-specific tokens

  // CamelCase or PascalCase (common in most languages)
  if (/[a-z][A-Z]/.test(token) || /^[A-Z][a-z]/.test(token)) {
    return true;
  }

  // snake_case (common in Python, Ruby)
  if (token.includes("_") && token.length > 4) {
    return true;
  }

  // Special prefixes/patterns common in various languages
  if (/^(on|handle|process|get|set|is|has|should|with)/i.test(token)) {
    return true;
  }

  // Tokens with numbers are often domain-specific
  if (/[a-z][0-9]/.test(token)) {
    return true;
  }

  // JavaScript/TypeScript specific
  if (
    (language === "javascript" || language === "typescript") &&
    (/\$/.test(token) || // Angular, jQuery
      /^use[A-Z]/.test(token))
  ) {
    // React hooks
    return true;
  }

  // Python specific
  if (
    language === "python" &&
    (/^__.*__$/.test(token) || // dunder methods
      /^self\./.test(token))
  ) {
    // instance attributes
    return true;
  }

  return false;
}

/**
 * Apply language-specific score boosts to tokens
 *
 * @param {string} token - The token to apply boosts to
 * @param {number} score - The current score
 * @param {string} language - The programming language
 * @returns {number} The updated score
 */
function applyLanguageSpecificBoosts(token, score, language) {
  switch (language) {
    case "javascript":
    case "typescript":
    case "jsx":
    case "tsx":
      // Boost React/component related terms
      if (
        /^(use|component|props|state|render|effect|memo|callback)/.test(token)
      ) {
        score *= 1.5;
      }
      // Boost event handler patterns
      if (/^(on[A-Z]|handle[A-Z])/.test(token)) {
        score *= 1.3;
      }
      break;

    case "python":
      // Boost important Python patterns
      if (/^(def|class|self|super|__init__|__main__)/.test(token)) {
        score *= 1.3;
      }
      // Boost decorators
      if (/^@/.test(token)) {
        score *= 1.4;
      }
      break;

    case "java":
    case "csharp":
    case "c#":
      // Boost important Java/C# patterns
      if (
        /^(public|private|protected|static|final|override|virtual|abstract)/.test(
          token
        )
      ) {
        score *= 1.2;
      }
      // Boost class/interface/enum declarations
      if (/^(class|interface|enum|record|struct)/.test(token)) {
        score *= 1.3;
      }
      break;

    case "ruby":
      // Boost Ruby-specific patterns
      if (/^(attr_|def|class|module|require|include|extend)/.test(token)) {
        score *= 1.3;
      }
      // Boost symbols
      if (/^:/.test(token)) {
        score *= 1.2;
      }
      break;

    case "go":
      // Boost Go-specific patterns
      if (/^(func|struct|interface|type|go|chan|defer|goroutine)/.test(token)) {
        score *= 1.3;
      }
      break;
  }

  return score;
}

/**
 * Get stop words for the specified language
 *
 * @param {string} language - The programming language
 * @returns {Set<string>} Set of stop words
 */
function getStopWords(language) {
  // Common English stop words
  const commonStopWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "if",
    "then",
    "else",
    "when",
    "at",
    "from",
    "by",
    "for",
    "with",
    "about",
    "against",
    "between",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "to",
    "is",
    "am",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "having",
    "do",
    "does",
    "did",
    "doing",
    "would",
    "should",
    "could",
    "ought",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "their",
    "this",
    "that",
    "these",
    "those",
    "of",
    "in",
    "as",
    "on",
    "not",
    "no",
    "its",
    "his",
    "her",
  ]);

  // Common programming language keywords
  const commonProgrammingStopWords = new Set([
    "function",
    "class",
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "return",
    "try",
    "catch",
    "finally",
    "throw",
    "throws",
    "public",
    "private",
    "protected",
    "static",
    "final",
    "abstract",
    "interface",
    "extends",
    "implements",
    "import",
    "export",
    "package",
    "namespace",
    "var",
    "let",
    "const",
    "new",
    "this",
    "super",
    "null",
    "undefined",
    "true",
    "false",
  ]);

  // Start with common stop words for all languages
  const stopWords = new Set([
    ...commonStopWords,
    ...commonProgrammingStopWords,
  ]);

  // Add language-specific stop words
  switch (language) {
    case "javascript":
    case "typescript":
    case "jsx":
    case "tsx":
      // JavaScript/TypeScript specific
      [
        "typeof",
        "instanceof",
        "async",
        "await",
        "yield",
        "void",
        "delete",
        "module",
        "require",
        "console",
        "log",
        "window",
        "document",
        "event",
        "prototype",
        "constructor",
        "string",
        "number",
        "boolean",
        "object",
        "array",
      ].forEach((word) => stopWords.add(word));
      break;

    case "python":
      // Python specific
      [
        "def",
        "lambda",
        "from",
        "as",
        "import",
        "with",
        "is",
        "in",
        "not",
        "and",
        "or",
        "global",
        "nonlocal",
        "pass",
        "yield",
        "assert",
        "del",
        "raise",
        "except",
        "print",
        "exec",
        "eval",
        "None",
        "True",
        "False",
        "range",
        "len",
        "self",
      ].forEach((word) => stopWords.add(word));
      break;

    case "java":
      // Java specific
      [
        "void",
        "boolean",
        "byte",
        "char",
        "short",
        "int",
        "long",
        "float",
        "double",
        "instanceof",
        "strictfp",
        "synchronized",
        "transient",
        "volatile",
        "native",
        "package",
        "throws",
        "throw",
        "exception",
        "assert",
        "enum",
      ].forEach((word) => stopWords.add(word));
      break;

    case "csharp":
    case "c#":
      // C# specific
      [
        "using",
        "namespace",
        "where",
        "select",
        "from",
        "group",
        "into",
        "orderby",
        "join",
        "equals",
        "out",
        "ref",
        "in",
        "value",
        "is",
        "as",
        "void",
        "int",
        "string",
        "bool",
        "decimal",
        "object",
        "char",
        "byte",
        "sbyte",
        "uint",
        "long",
        "ulong",
        "short",
        "ushort",
        "double",
        "float",
        "dynamic",
        "delegate",
        "event",
        "async",
        "await",
        "partial",
        "virtual",
        "override",
        "sealed",
        "base",
      ].forEach((word) => stopWords.add(word));
      break;

    case "ruby":
      // Ruby specific
      [
        "def",
        "end",
        "module",
        "require",
        "include",
        "extend",
        "attr",
        "attr_reader",
        "attr_writer",
        "attr_accessor",
        "lambda",
        "proc",
        "yield",
        "self",
        "nil",
        "true",
        "false",
        "unless",
        "until",
        "begin",
        "rescue",
        "ensure",
        "alias",
      ].forEach((word) => stopWords.add(word));
      break;

    case "go":
      // Go specific
      [
        "func",
        "type",
        "struct",
        "interface",
        "map",
        "chan",
        "go",
        "select",
        "package",
        "import",
        "const",
        "var",
        "iota",
        "make",
        "new",
        "append",
        "len",
        "cap",
        "nil",
        "true",
        "false",
        "int",
        "int8",
        "int16",
        "int32",
        "int64",
        "uint",
        "uint8",
        "uint16",
        "uint32",
        "uint64",
        "float32",
        "float64",
        "string",
        "byte",
        "rune",
        "defer",
        "panic",
        "recover",
      ].forEach((word) => stopWords.add(word));
      break;
  }

  return stopWords;
}

/**
 * Generic tokenization for unknown languages or plaintext
 *
 * @param {string} text - The text to tokenize
 * @returns {string[]} An array of tokens
 */
function tokenizeGeneric(text) {
  // Replace common punctuation with spaces before splitting
  // But preserve meaningful symbols like _, -, #, @ if part of identifiers
  const withSpaces = text
    // Preserve common identifier patterns
    .replace(/([a-z0-9])[-_]([a-z0-9])/g, "$1\u0001$2") // Replace with placeholder
    // Add space around punctuation
    .replace(/[.,;:(){}[\]<>?!]/g, " $& ")
    // Restore preserved symbols
    .replace(/\u0001/g, "_");

  // Split by whitespace and filter out empty tokens
  let tokens = withSpaces.split(/\s+/).filter((token) => token.length > 0);

  return tokens;
}

/**
 * JavaScript/TypeScript-specific tokenization
 * Handles camelCase, PascalCase, module imports, JSX tags, template literals, decorators
 *
 * @param {string} text - The JavaScript/TypeScript text to tokenize
 * @returns {string[]} An array of tokens
 */
function tokenizeJavaScript(text) {
  let tokens = [];

  // Preserve comments for content analysis but mark them specially
  const commentPlaceholders = {};
  let commentCounter = 0;

  // Remove block comments first
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const placeholder = `__COMMENT_BLOCK_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });

  // Remove line comments
  const withoutComments = withoutBlockComments.replace(
    /\/\/[^\n]*/g,
    (match) => {
      const placeholder = `__COMMENT_LINE_${commentCounter++}__`;
      commentPlaceholders[placeholder] = match;
      return placeholder;
    }
  );

  // Track string literals and code blocks to avoid tokenizing their contents incorrectly
  const stringPlaceholders = {};
  let stringCounter = 0;

  // Handle regex literals - important to do this before handling division operator
  // Look for patterns like /.../ not preceded by identifiers or closing brackets/parentheses
  const withoutRegex = withoutComments.replace(
    /(?<![a-zA-Z0-9_\)\]\}])\/(?:\\\/|[^\/\n])+\/[gimuy]*/g,
    (match) => {
      const placeholder = `__REGEX_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );

  // Handle template literals with interpolation
  // Capture the whole template including expressions inside ${}
  const withoutTemplateLiterals = withoutRegex.replace(
    /`(?:\\`|\\\\|[^`])*`/g,
    (match) => {
      const placeholder = `__TEMPLATE_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Extract interpolated expressions from ${...} and tokenize them separately
      const expressions = [];
      let expContent = match.match(/\${([^}]*)}/g);
      if (expContent) {
        expContent.forEach((exp) => {
          expressions.push(exp.slice(2, -1)); // Remove ${ and }
        });

        // Tokenize each expression content
        expressions.forEach((exp) => {
          const expTokens = tokenizeJavaScript(exp); // Recursively tokenize expressions
          tokens.push(...expTokens);
        });
      }

      return placeholder;
    }
  );

  // Handle string literals with placeholder
  const withoutStrings = withoutTemplateLiterals.replace(
    /'(?:\\'|\\\\|[^'])*'|"(?:\\"|\\\\|[^"])*"/g,
    (match) => {
      const placeholder = `__STRING_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );

  // Handle JSX tags - more comprehensive approach for nested components
  // First, capture JSX opening tags, self-closing tags, and closing tags
  const withoutJSX = withoutStrings.replace(
    /<([A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*)((?:\s+[a-zA-Z0-9_]+(?:=(?:"|'|\{).*?(?:"|'|\}))?)*)\s*(?:\/)?>/g,
    (match, tagName, attributes) => {
      const placeholder = `__JSX_TAG_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Add the tag name as token
      tokens.push(tagName);

      // Extract and add attribute names
      if (attributes) {
        const attrMatches = attributes.match(/[a-zA-Z0-9_]+(?==)/g);
        if (attrMatches) {
          tokens.push(...attrMatches);
        }
      }

      return placeholder;
    }
  );

  // Handle JSX closing tags
  const withoutJSXClosing = withoutJSX.replace(
    /<\/([A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*)>/g,
    (match, tagName) => {
      const placeholder = `__JSX_CLOSING_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push(tagName);
      return placeholder;
    }
  );

  // Handle decorators with placeholder - more comprehensive for complex decorators
  const withoutDecorators = withoutJSXClosing.replace(
    /@([a-zA-Z][a-zA-Z0-9_]*)(?:\((?:[^)(]*|\([^)(]*\))*\))?/g,
    (match, decoratorName) => {
      const placeholder = `__DECORATOR_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Add the decorator name as token
      tokens.push(decoratorName);

      // If there are parameters to the decorator, tokenize them separately
      const paramMatch = match.match(/\((.*)\)/);
      if (paramMatch && paramMatch[1]) {
        const paramTokens = tokenizeGeneric(paramMatch[1]);
        tokens.push(...paramTokens);
      }

      return placeholder;
    }
  );

  // Handle arrow functions specially
  const withoutArrows = withoutDecorators.replace(/=>/g, (match) => {
    tokens.push("arrow_function"); // Use a special token for recognizing arrow functions
    return " => "; // Preserve the token but with spaces for other tokenization
  });

  // Handle optional chaining and nullish coalescing
  const withSpecialOps = withoutArrows
    .replace(/\?\./g, (match) => {
      tokens.push("optional_chaining");
      return " ?. "; // Space-separated for tokenization
    })
    .replace(/\?\?/g, (match) => {
      tokens.push("nullish_coalescing");
      return " ?? "; // Space-separated for tokenization
    });

  // Handle import statements more robustly
  const withoutImports = withSpecialOps.replace(
    /import\s+(?:{[^}]*}|\*\s+as\s+[a-zA-Z][a-zA-Z0-9_]*|[a-zA-Z][a-zA-Z0-9_]*)\s+from\s+['"][^'"]*['"]/g,
    (match) => {
      // Add import as a token
      tokens.push("import");

      // Extract module name
      const moduleMatch = match.match(/from\s+['"]([^'"]*)['"]/);
      if (moduleMatch && moduleMatch[1]) {
        tokens.push(moduleMatch[1]);
      }

      // Extract imported identifiers
      const importedMatch = match.match(
        /import\s+({[^}]*}|\*\s+as\s+[a-zA-Z][a-zA-Z0-9_]*|[a-zA-Z][a-zA-Z0-9_]*)/
      );
      if (importedMatch && importedMatch[1]) {
        const importSection = importedMatch[1];

        if (importSection.startsWith("{")) {
          // Named imports
          const namedImports = importSection
            .replace(/[{}]/g, "")
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);

          tokens.push(...namedImports);
        } else if (importSection.includes("* as")) {
          // Namespace import
          const nsMatch = importSection.match(
            /\*\s+as\s+([a-zA-Z][a-zA-Z0-9_]*)/
          );
          if (nsMatch && nsMatch[1]) {
            tokens.push(nsMatch[1]);
          }
        } else {
          // Default import
          tokens.push(importSection.trim());
        }
      }

      return " "; // Replace with a space
    }
  );

  // Split remaining text into tokens
  let mainTokens = tokenizeGeneric(withoutImports);

  // Handle camelCase and PascalCase by splitting them into separate tokens
  const processedTokens = [];
  for (const token of mainTokens) {
    // Skip placeholder tokens (we'll handle them separately)
    if (token.startsWith("__") && token.endsWith("__")) {
      processedTokens.push(token);
      continue;
    }

    // Skip operators we've already handled
    if (["=>", "?.", "??"].includes(token)) {
      processedTokens.push(token);
      continue;
    }

    // Split camelCase into separate tokens
    const camelTokens = token
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(" ");

    // Add original token and split tokens
    processedTokens.push(token);
    if (camelTokens.length > 1) {
      processedTokens.push(...camelTokens);
    }
  }

  // Replace placeholders with their original values
  const finalTokens = [];
  for (const token of processedTokens) {
    if (stringPlaceholders[token]) {
      // Add the original placeholder as a token (to preserve context)
      if (token.startsWith("__REGEX_")) {
        finalTokens.push("regex_literal");
      } else if (token.startsWith("__JSX_")) {
        finalTokens.push("jsx_element");
      } else if (token.startsWith("__DECORATOR_")) {
        finalTokens.push("decorator");
      } else {
        finalTokens.push(token);
      }

      // For string literals, also add their content as tokens
      if (token.startsWith("__STRING_") || token.startsWith("__TEMPLATE_")) {
        // Extract content and add relevant words
        const content = stringPlaceholders[token];
        // Remove quotes/backticks and tokenize content
        const strContent = content.replace(/^[`'"](.*)[`'"]$/s, "$1");
        const contentTokens = tokenizeGeneric(strContent);
        finalTokens.push(...contentTokens);
      }
    } else if (commentPlaceholders[token]) {
      // For comments, optionally extract keywords if needed
      // Don't add the full comment as a token to avoid noise
      finalTokens.push("code_comment");

      // Extract possible important terms from comments
      const commentContent = commentPlaceholders[token]
        .replace(/^\/\*|\*\/$/g, "") // Remove /* */
        .replace(/^\/\//g, ""); // Remove //

      // Only use alphanumeric words from comments, skip punctuation and symbols
      const commentTokens = commentContent
        .split(/\s+/)
        .filter((word) => /^[a-z0-9_]{3,}$/i.test(word))
        .map((word) => word.toLowerCase());

      finalTokens.push(...commentTokens);
    } else {
      finalTokens.push(token);
    }
  }

  return [...new Set(finalTokens)]; // Remove duplicates
}

/**
 * Python-specific tokenization
 * Handles snake_case, decorators, f-strings, indentation significance
 *
 * @param {string} text - The Python text to tokenize
 * @returns {string[]} An array of tokens
 */
function tokenizePython(text) {
  let tokens = [];

  // Preserve comments for content analysis but mark them specially
  const commentPlaceholders = {};
  let commentCounter = 0;

  // Remove block comments first (triple-quoted strings when used as comments)
  const withoutDocstrings = text.replace(
    /(?:'''[\s\S]*?'''|"""[\s\S]*?""")/g,
    (match) => {
      const placeholder = `__PYCOMMENT_BLOCK_${commentCounter++}__`;
      commentPlaceholders[placeholder] = match;
      return placeholder;
    }
  );

  // Remove line comments
  const withoutComments = withoutDocstrings.replace(/#[^\n]*/g, (match) => {
    const placeholder = `__PYCOMMENT_LINE_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });

  // Handle string literals
  const stringPlaceholders = {};
  let placeholderCounter = 0;

  // Enhanced f-string handling - look for f, fr, rf prefixes and capture interpolation
  const withoutFStrings = withoutComments.replace(
    /(?:f|fr|rf)(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\'|\\\\|[^'])*'|"(?:\\"|\\\\|[^"])*")/g,
    (match) => {
      const placeholder = `__PYFSTRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Extract interpolated expressions from {...} and tokenize them separately
      const expressions = [];
      // Match {expression} but not escaped \{
      let expContent = match.match(/(?<!\\){([^{}]*)}/g);
      if (expContent) {
        expContent.forEach((exp) => {
          expressions.push(exp.slice(1, -1)); // Remove { and }
        });

        // Tokenize each expression content
        expressions.forEach((exp) => {
          const expTokens = tokenizePython(exp); // Recursively tokenize expressions
          tokens.push(...expTokens);
        });
      }

      return placeholder;
    }
  );

  // Handle other string literals (r-strings, normal strings)
  const withoutSpecialStrings = withoutFStrings.replace(
    /(?:r|b|rb|br)?(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\'|\\\\|[^'])*'|"(?:\\"|\\\\|[^"])*")/g,
    (match) => {
      const placeholder = `__PYSTRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );

  // Handle decorators with placeholder - more comprehensive for complex decorators
  const withoutDecorators = withoutSpecialStrings.replace(
    /@([a-zA-Z][a-zA-Z0-9_.]*)(?:\((?:[^)(]*|\([^)(]*\))*\))?/g,
    (match, decoratorName) => {
      const placeholder = `__PYDECORATOR_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Add decorator name as token
      tokens.push(decoratorName);

      // If the decorator has parameters, extract and tokenize them
      const paramMatch = match.match(/\((.*)\)/);
      if (paramMatch && paramMatch[1]) {
        const paramTokens = tokenizeGeneric(paramMatch[1]);
        tokens.push(...paramTokens);
      }

      return placeholder;
    }
  );

  // Handle Python-specific operators
  const withSpecialOps = withoutDecorators
    // Handle walrus operator :=
    .replace(/:=/g, (match) => {
      tokens.push("walrus_operator");
      return " := "; // Space-separated for tokenization
    })
    // Handle list splices with :
    .replace(/\[.*:.*\]/g, (match) => {
      tokens.push("slice_operation");
      // Process what's inside the brackets
      const innerContent = match.slice(1, -1);
      const sliceParts = innerContent.split(":");
      sliceParts.forEach((part) => {
        if (part.trim()) {
          const partTokens = tokenizeGeneric(part.trim());
          tokens.push(...partTokens);
        }
      });
      return match; // Preserve for general tokenization
    });

  // Process lines with indentation awareness
  const lines = withSpecialOps.split("\n");

  // Track indentation levels
  let previousIndentLevel = 0;

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === "") continue;

    // Count leading spaces/tabs to track indentation
    const indentMatch = line.match(/^(\s*)/);
    const leadingSpaces = indentMatch ? indentMatch[1].length : 0;

    if (leadingSpaces !== previousIndentLevel) {
      if (leadingSpaces > previousIndentLevel) {
        // Indentation increased - add token for indent
        tokens.push("indent");
      } else {
        // Indentation decreased - add token for dedent
        // Add one dedent token for each level decreased
        const dedentLevels = Math.floor(
          (previousIndentLevel - leadingSpaces) / 4
        );
        for (let i = 0; i < dedentLevels; i++) {
          tokens.push("dedent");
        }
      }
      previousIndentLevel = leadingSpaces;
    }

    // Tokenize the line content by first removing the leading whitespace
    const lineContent = line.trim();
    if (lineContent) {
      // Check for keyword tokens
      const pythonKeywords = [
        "def",
        "class",
        "lambda",
        "return",
        "yield",
        "from",
        "import",
        "as",
        "with",
        "try",
        "except",
        "finally",
        "raise",
        "assert",
        "if",
        "elif",
        "else",
        "while",
        "for",
        "in",
        "continue",
        "break",
        "pass",
        "global",
        "nonlocal",
        "del",
        "is",
        "not",
        "and",
        "or",
        "async",
        "await",
        "comprehension",
        "self",
      ];

      // Add line content keywords
      for (const keyword of pythonKeywords) {
        if (lineContent.includes(keyword)) {
          const keywordRegex = new RegExp(`\\b${keyword}\\b`, "g");
          if (keywordRegex.test(lineContent)) {
            tokens.push(keyword);
          }
        }
      }

      // Now tokenize the whole line
      const lineTokens = tokenizeGeneric(lineContent);
      tokens.push(...lineTokens);
    }
  }

  // Add keyword for Python-specific list operations
  if (
    withSpecialOps.includes("append(") ||
    withSpecialOps.includes(".extend(")
  ) {
    tokens.push("list_operation");
  }

  // Add keyword for Python-specific dictionary operations
  if (
    withSpecialOps.includes(".get(") ||
    withSpecialOps.includes(".items()") ||
    withSpecialOps.includes(".keys()") ||
    withSpecialOps.includes(".values()")
  ) {
    tokens.push("dict_operation");
  }

  // Split snake_case identifiers
  const snakeCaseTokens = [];
  for (const token of tokens) {
    // Skip placeholder tokens
    if (token.startsWith("__") && token.endsWith("__")) {
      snakeCaseTokens.push(token);
      continue;
    }

    // Split snake_case
    if (token.includes("_")) {
      const parts = token.split("_").filter((part) => part.length > 0);
      snakeCaseTokens.push(token); // Original token
      snakeCaseTokens.push(...parts); // Parts of the token
    } else {
      snakeCaseTokens.push(token);
    }
  }

  // Replace placeholders with their original values and process them
  const finalTokens = [];
  for (const token of snakeCaseTokens) {
    if (stringPlaceholders[token]) {
      if (token.startsWith("__PYFSTRING_")) {
        finalTokens.push("f_string");
      } else if (token.startsWith("__PYSTRING_")) {
        finalTokens.push("string_literal");
      } else if (token.startsWith("__PYDECORATOR_")) {
        finalTokens.push("decorator");
      } else {
        finalTokens.push(token);
      }

      // For string placeholders, also tokenize their content
      if (token.startsWith("__PYSTRING_") || token.startsWith("__PYFSTRING_")) {
        const content = stringPlaceholders[token];
        // Extract the content without prefix and quotes
        let strContent = content;

        // Handle different types of string literals
        if (
          strContent.startsWith("f") ||
          strContent.startsWith("r") ||
          strContent.startsWith("fr") ||
          strContent.startsWith("rf") ||
          strContent.startsWith("b") ||
          strContent.startsWith("rb") ||
          strContent.startsWith("br")
        ) {
          const prefixLength = /^[a-z]+/.exec(strContent)[0].length;
          strContent = strContent.substring(prefixLength);
        }

        // Remove quotes
        strContent = strContent.replace(/^['"]|['"]$/g, "");
        strContent = strContent.replace(/^'''|'''$/g, "");
        strContent = strContent.replace(/^"""|"""$/g, "");

        // Remove f-string interpolation markers
        strContent = strContent.replace(/{[^{}]*}/g, " ");

        // Tokenize content
        const contentTokens = tokenizeGeneric(strContent);
        finalTokens.push(...contentTokens);
      }
    } else if (commentPlaceholders[token]) {
      // Extract useful keywords from comments
      finalTokens.push("code_comment");

      // Extract possible important terms from comments
      const commentContent = commentPlaceholders[token]
        .replace(/^#{1}/, "") // Remove #
        .replace(/^'''|'''$/g, "") // Remove '''
        .replace(/^"""|"""$/g, ""); // Remove """

      // Only use alphanumeric words from comments, skip punctuation and symbols
      const commentTokens = commentContent
        .split(/\s+/)
        .filter((word) => /^[a-z0-9_]{3,}$/i.test(word))
        .map((word) => word.toLowerCase());

      finalTokens.push(...commentTokens);
    } else {
      finalTokens.push(token);
    }
  }

  return [...new Set(finalTokens)]; // Remove duplicates
}

/**
 * Java/C#-like language tokenization
 * Handles annotations, generics, access modifiers, lambda expressions
 *
 * @param {string} text - The Java or C# text to tokenize
 * @returns {string[]} An array of tokens
 */
function tokenizeJavaLike(text) {
  let tokens = [];

  // Preserve comments for content analysis but mark them specially
  const commentPlaceholders = {};
  let commentCounter = 0;

  // Remove block comments first
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const placeholder = `__JAVA_COMMENT_BLOCK_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });

  // Remove line comments
  const withoutComments = withoutBlockComments.replace(
    /\/\/[^\n]*/g,
    (match) => {
      const placeholder = `__JAVA_COMMENT_LINE_${commentCounter++}__`;
      commentPlaceholders[placeholder] = match;
      return placeholder;
    }
  );

  // Handle string literals with placeholders
  const stringPlaceholders = {};
  let placeholderCounter = 0;

  // Handle string literals (support escaping)
  const withoutStrings = withoutComments.replace(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
    (match) => {
      const placeholder = `__JAVASTRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );

  // Handle annotations with parameters more comprehensively
  const withoutAnnotations = withoutStrings.replace(
    /@([a-zA-Z][a-zA-Z0-9_.]*)(?:\s*\((?:[^)(]*|\([^)(]*\))*\))?/g,
    (match, annotationName) => {
      const placeholder = `__ANNOTATION_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Add annotation name as a token
      tokens.push("annotation");
      tokens.push(annotationName.toLowerCase());

      // Extract and process annotation parameters
      const paramMatch = match.match(/\((.*)\)/);
      if (paramMatch && paramMatch[1]) {
        const params = paramMatch[1];

        // Handle key-value pairs in annotations
        const keyValuePairs = params.split(",");
        for (const pair of keyValuePairs) {
          const parts = pair.split("=");
          if (parts.length === 2) {
            // Add parameter name as token
            tokens.push(parts[0].trim());
          }
          // Tokenize the values
          const valueTokens = tokenizeGeneric(pair);
          tokens.push(...valueTokens);
        }
      }

      return placeholder;
    }
  );

  // Handle generics with better nesting support
  // This pattern can handle nested generics like Map<String, List<Integer>>
  const withoutGenerics = withoutAnnotations.replace(
    /<([^<>]*(?:<[^<>]*(?:<[^<>]*>)*[^<>]*>)*[^<>]*)>/g,
    (match) => {
      const placeholder = `__GENERIC_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Add token for generic type usage
      tokens.push("generic_type");

      // Process the content within the generic
      // Remove the < and > delimiters
      const content = match.slice(1, -1);

      // Split by commas to get individual type parameters
      const typeParams = content.split(/,(?![^<>]*>)/); // Split by commas not within angle brackets

      // Process each type parameter
      for (const param of typeParams) {
        const paramTokens = tokenizeGeneric(param.trim());
        tokens.push(...paramTokens);
      }

      return placeholder;
    }
  );

  // Handle lambda expressions (Java: -> and C#: =>)
  const withoutLambdas = withoutGenerics.replace(
    /(?:\(.*?\)|[a-zA-Z_][a-zA-Z0-9_]*)\s*(?:->|=>)\s*(?:{[\s\S]*?}|[^;]*)/g,
    (match) => {
      const placeholder = `__LAMBDA_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Add token for lambda expression
      tokens.push("lambda_expression");

      // Tokenize the entire lambda expression to extract parameter and body tokens
      const lambdaTokens = tokenizeGeneric(match);
      tokens.push(...lambdaTokens);

      return placeholder;
    }
  );

  // Extract and add access modifiers as specific tokens
  const accessModifiers = [
    "public",
    "private",
    "protected",
    "internal",
    "static",
    "final",
    "abstract",
    "override",
    "virtual",
    "readonly",
    "const",
    "sealed",
    "partial",
    "async",
    "volatile",
    "transient",
    "synchronized",
    "unsafe",
    "extern",
  ];

  let withAccessModifiers = withoutLambdas;
  for (const modifier of accessModifiers) {
    // Use word boundaries to match whole words
    const regex = new RegExp(`\\b${modifier}\\b`, "gi");
    withAccessModifiers = withAccessModifiers.replace(regex, (match) => {
      tokens.push(match.toLowerCase());
      tokens.push("access_modifier");
      return match;
    });
  }

  // Handle package/namespace declarations
  withAccessModifiers = withAccessModifiers.replace(
    /\b(?:package|namespace)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/g,
    (match, packageName) => {
      tokens.push("package_declaration");

      // Add the package name and its components
      const packageParts = packageName.split(".");
      tokens.push(packageName);
      tokens.push(...packageParts);

      return match;
    }
  );

  // Handle import/using statements
  withAccessModifiers = withAccessModifiers.replace(
    /\b(?:import|using)\s+(?:static\s+)?([a-zA-Z_][a-zA-Z0-9_.]*(?:\.\*)?)/g,
    (match, importName) => {
      tokens.push("import_statement");

      // Add the import name and its components
      const importParts = importName.split(".");
      tokens.push(importName);
      // Remove wildcard * from last part if present
      if (
        importParts.length > 0 &&
        importParts[importParts.length - 1] === "*"
      ) {
        importParts.pop();
        tokens.push("wildcard_import");
      }
      tokens.push(...importParts);

      return match;
    }
  );

  // Handle common C# LINQ expressions
  if (/\bfrom\b.*\bin\b.*\bselect\b/i.test(withAccessModifiers)) {
    tokens.push("linq_expression");

    // Extract common LINQ keywords
    const linqKeywords = [
      "from",
      "in",
      "select",
      "where",
      "group",
      "by",
      "into",
      "orderby",
      "join",
      "let",
      "on",
      "equals",
    ];

    for (const keyword of linqKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "gi");
      if (regex.test(withAccessModifiers)) {
        tokens.push(`linq_${keyword}`);
      }
    }
  }

  // Add remaining tokens
  const mainTokens = tokenizeGeneric(withAccessModifiers);
  tokens.push(...mainTokens);

  // Handle camelCase and PascalCase with more specialized type names
  const processedTokens = [];
  for (const token of tokens) {
    // Skip placeholder tokens
    if (token.startsWith("__") && token.endsWith("__")) {
      processedTokens.push(token);
      continue;
    }

    // Check if token might be a fully qualified name (contains dots)
    if (token.includes(".")) {
      const parts = token.split(".");
      processedTokens.push(token); // Add the full token
      processedTokens.push(...parts); // Add individual parts
      continue;
    }

    // Split PascalCase and camelCase
    // Add original token first
    processedTokens.push(token);

    // Then add split tokens if there's a case change
    if (/[a-z][A-Z]/.test(token)) {
      const parts = token
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(" ");

      if (parts.length > 1) {
        processedTokens.push(...parts);
      }
    }
  }

  // Replace placeholders with their original values
  const finalTokens = [];
  for (const token of processedTokens) {
    if (stringPlaceholders[token]) {
      // Add information about what kind of structure this is
      if (token.startsWith("__JAVASTRING_")) {
        finalTokens.push("string_literal");
      } else if (token.startsWith("__ANNOTATION_")) {
        finalTokens.push("annotation");
      } else if (token.startsWith("__GENERIC_")) {
        finalTokens.push("generic");
      } else if (token.startsWith("__LAMBDA_")) {
        finalTokens.push("lambda");
      } else {
        finalTokens.push(token);
      }

      // For string literals, add their content as tokens
      if (token.startsWith("__JAVASTRING_")) {
        const content = stringPlaceholders[token];
        // Extract the content without the quotes
        const strContent = content.replace(/^"|"$/g, "").replace(/^'|'$/g, "");

        // Only tokenize non-empty content
        if (strContent.trim().length > 0) {
          const contentTokens = tokenizeGeneric(strContent);
          finalTokens.push(...contentTokens);
        }
      }
    } else if (commentPlaceholders[token]) {
      // Extract useful keywords from comments
      finalTokens.push("code_comment");

      // Extract possible important terms from comments
      const commentContent = commentPlaceholders[token]
        .replace(/^\/\*|\*\/$/g, "") // Remove /* */
        .replace(/^\/\//g, ""); // Remove //

      // Only use alphanumeric words from comments, skip punctuation and symbols
      const commentTokens = commentContent
        .split(/\s+/)
        .filter((word) => /^[a-z0-9_]{3,}$/i.test(word))
        .map((word) => word.toLowerCase());

      finalTokens.push(...commentTokens);
    } else {
      finalTokens.push(token);
    }
  }

  return [...new Set(finalTokens)]; // Remove duplicates
}

/**
 * Ruby-specific tokenization
 * Handles symbols, blocks, string interpolation, and range operators
 *
 * @param {string} text - The Ruby text to tokenize
 * @returns {string[]} An array of tokens
 */
function tokenizeRuby(text) {
  let tokens = [];

  // Preserve comments for content analysis but mark them specially
  const commentPlaceholders = {};
  let commentCounter = 0;

  // Remove block comments (=begin...=end)
  const withoutBlockComments = text.replace(/=begin[\s\S]*?=end/g, (match) => {
    const placeholder = `__RUBY_COMMENT_BLOCK_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });

  // Remove line comments
  const withoutComments = withoutBlockComments.replace(/#[^\n]*/g, (match) => {
    const placeholder = `__RUBY_COMMENT_LINE_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });

  // Handle string literals and placeholders
  const stringPlaceholders = {};
  let placeholderCounter = 0;

  // Handle string interpolation (#{...}) in double-quoted strings
  // This is similar to f-strings in Python
  const withoutInterpolation = withoutComments.replace(
    /"(?:[^"\\]|\\.|#\{[^}]*\})*"/g,
    (match) => {
      const placeholder = `__RUBY_INTERPOLATED_STRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Extract interpolated expressions from #{...} and tokenize them separately
      const expressions = [];
      let expContent = match.match(/#\{([^}]*)\}/g);
      if (expContent) {
        expContent.forEach((exp) => {
          expressions.push(exp.slice(2, -1)); // Remove #{ and }
        });

        // Tokenize each expression content
        expressions.forEach((exp) => {
          const expTokens = tokenizeRuby(exp); // Recursively tokenize expressions
          tokens.push(...expTokens);
        });
      }

      return placeholder;
    }
  );

  // Handle other string literals (including %q, %Q, heredocs)
  const withoutStrings = withoutInterpolation.replace(
    /('(?:[^'\\]|\\.)*'|%[qQ]?\{(?:[^\\}]|\\.)*\}|%[qQ]?\((?:[^\\)]|\\.)*\)|%[qQ]?\[(?:[^\\]]|\\.)*\]|%[qQ]?<(?:[^\\>]|\\.)*>|<<-?(['"]?)(\w+)\1[\s\S]*?\2)/g,
    (match) => {
      const placeholder = `__RUBY_STRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );

  // Handle regular expressions with placeholder
  const withoutRegexps = withoutStrings.replace(
    /\/(?:[^\/\\]|\\.)*\/[iomxneus]*/g,
    (match) => {
      const placeholder = `__RUBY_REGEXP_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push("regexp");
      return placeholder;
    }
  );

  // Handle Ruby symbols with placeholder
  const withoutSymbols = withoutRegexps.replace(
    /:(?:@?[a-zA-Z_][a-zA-Z0-9_]*(?:[?!]|=(?!=))?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g,
    (match) => {
      const placeholder = `__RUBY_SYMBOL_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Extract symbol name without the colon
      const symbolName = match.substring(1);
      tokens.push("symbol");
      tokens.push(`symbol_${symbolName}`);

      // Add the base name without question mark or exclamation mark
      if (symbolName.endsWith("?") || symbolName.endsWith("!")) {
        tokens.push(`symbol_${symbolName.slice(0, -1)}`);
      }

      return placeholder;
    }
  );

  // Handle blocks (do...end and {...}) with placeholder
  let withoutBlocks = withoutSymbols;

  // do...end blocks
  withoutBlocks = withoutBlocks.replace(
    /\bdo\s*(?:\|[^|]*\|)?[\s\S]*?\bend\b/g,
    (match) => {
      const placeholder = `__RUBY_BLOCK_DO_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;

      tokens.push("block_do_end");

      // Extract block parameters
      const paramMatch = match.match(/\|\s*([^|]*)\s*\|/);
      if (paramMatch && paramMatch[1]) {
        const params = paramMatch[1].split(",");
        params.forEach((param) => {
          tokens.push(param.trim());
        });
      }

      // Tokenize block content
      const blockContent = match
        .replace(/\bdo\s*(?:\|[^|]*\|)?/, "") // Remove 'do' and params
        .replace(/\bend\b$/, ""); // Remove 'end'

      const contentTokens = tokenizeGeneric(blockContent);
      tokens.push(...contentTokens);

      return placeholder;
    }
  );

  // {...} blocks
  withoutBlocks = withoutBlocks.replace(
    /\{(?:\s*\|[^|]*\|\s*)?[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g,
    (match) => {
      // Skip if it looks like a Hash literal rather than a block
      if (/^\{\s*:/.test(match) || /^\{\s*['"]/.test(match)) {
        return match; // Process as a Hash literal (key-value pairs)
      }

      const placeholder = `__RUBY_BLOCK_BRACE_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;

      tokens.push("block_brace");

      // Extract block parameters
      const paramMatch = match.match(/\|\s*([^|]*)\s*\|/);
      if (paramMatch && paramMatch[1]) {
        const params = paramMatch[1].split(",");
        params.forEach((param) => {
          tokens.push(param.trim());
        });
      }

      // Process the content without parameters
      let blockContent = match.slice(1, -1); // Remove { and }
      if (paramMatch) {
        blockContent = blockContent.replace(/\|\s*[^|]*\s*\|/, "");
      }

      const contentTokens = tokenizeGeneric(blockContent);
      tokens.push(...contentTokens);

      return placeholder;
    }
  );

  // Handle range operators (.., ...)
  let withRangeOps = withoutBlocks.replace(/\.\.(\.)?/g, (match) => {
    tokens.push(
      match === ".." ? "range_operator_inclusive" : "range_operator_exclusive"
    );
    return " " + match + " "; // Space-padded for tokenization
  });

  // Handle Ruby method definition with symbols
  withRangeOps = withRangeOps.replace(
    /\bdef\s+(?:self\.)?([a-zA-Z_][a-zA-Z0-9_]*[?!=]?)/g,
    (match, methodName) => {
      tokens.push("method_definition");
      tokens.push(methodName);

      // Add method name without special character suffix
      if (
        methodName.endsWith("?") ||
        methodName.endsWith("!") ||
        methodName.endsWith("=")
      ) {
        tokens.push(methodName.slice(0, -1));
      }

      return match;
    }
  );

  // Handle class and module definitions
  withRangeOps = withRangeOps.replace(
    /\b(?:class|module)\s+([A-Z][a-zA-Z0-9_]*(?:::[A-Z][a-zA-Z0-9_]*)*)/g,
    (match, className) => {
      tokens.push(
        match.startsWith("class") ? "class_definition" : "module_definition"
      );

      // Add class/module name
      tokens.push(className);

      // Add namespace components
      if (className.includes("::")) {
        const parts = className.split("::");
        tokens.push(...parts);
      }

      return match;
    }
  );

  // Tokenize what's left with generic tokenization
  const genericTokens = tokenizeGeneric(withRangeOps);

  // Add common Ruby keywords if present
  const rubyKeywords = [
    "if",
    "unless",
    "else",
    "elsif",
    "end",
    "begin",
    "rescue",
    "ensure",
    "while",
    "until",
    "for",
    "break",
    "next",
    "redo",
    "retry",
    "return",
    "super",
    "self",
    "nil",
    "true",
    "false",
    "and",
    "or",
    "not",
    "yield",
  ];

  for (const keyword of rubyKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, "g");
    if (regex.test(withRangeOps)) {
      tokens.push(keyword);
    }
  }

  tokens.push(...genericTokens);

  // Process tokens for Ruby method calling convention
  const processedTokens = [];
  for (const token of tokens) {
    // Skip placeholder tokens
    if (token.startsWith("__RUBY_")) {
      processedTokens.push(token);
      continue;
    }

    processedTokens.push(token);

    // Also add version without trailing ? or !
    if (token.endsWith("?") || token.endsWith("!")) {
      processedTokens.push(token.slice(0, -1));
    }

    // Also add version without = for attribute setters
    if (
      token.endsWith("=") &&
      !["==", "!=", ">=", "<=", "=>"].includes(token)
    ) {
      processedTokens.push(token.slice(0, -1));
    }
  }

  // Replace placeholders with their original values and extract content
  const finalTokens = [];
  for (const token of processedTokens) {
    if (stringPlaceholders[token]) {
      // Categorize by token type
      if (
        token.startsWith("__RUBY_STRING_") ||
        token.startsWith("__RUBY_INTERPOLATED_STRING_")
      ) {
        finalTokens.push("string_literal");

        // Extract and tokenize string content
        const content = stringPlaceholders[token];
        let strContent = content;

        // Remove quotes
        if (strContent.startsWith("'") && strContent.endsWith("'")) {
          strContent = strContent.slice(1, -1);
        } else if (strContent.startsWith('"') && strContent.endsWith('"')) {
          strContent = strContent.slice(1, -1);
        } else if (strContent.startsWith("%q") || strContent.startsWith("%Q")) {
          // Handle %q/%Q strings
          strContent = strContent.slice(3, -1);
        }

        // Remove interpolation markers
        strContent = strContent.replace(/#\{[^}]*\}/g, " ");

        // Tokenize content if not empty
        if (strContent.trim()) {
          const contentTokens = tokenizeGeneric(strContent);
          finalTokens.push(...contentTokens);
        }
      } else if (token.startsWith("__RUBY_SYMBOL_")) {
        finalTokens.push("symbol");
      } else if (token.startsWith("__RUBY_BLOCK_")) {
        finalTokens.push("block");
      } else if (token.startsWith("__RUBY_REGEXP_")) {
        finalTokens.push("regexp");
      } else {
        finalTokens.push(token);
      }
    } else if (commentPlaceholders[token]) {
      // Extract useful keywords from comments
      finalTokens.push("code_comment");

      // Extract possible important terms from comments
      const commentContent = commentPlaceholders[token]
        .replace(/^#/, "") // Remove # for line comments
        .replace(/^=begin\s*|\s*=end$/g, ""); // Remove =begin/=end for block comments

      // Only use alphanumeric words from comments, skip punctuation and symbols
      const commentTokens = commentContent
        .split(/\s+/)
        .filter((word) => /^[a-z0-9_]{3,}$/i.test(word))
        .map((word) => word.toLowerCase());

      finalTokens.push(...commentTokens);
    } else {
      finalTokens.push(token);
    }
  }

  return [...new Set(finalTokens)]; // Remove duplicates
}

/**
 * Go-specific tokenization
 * Handles struct tags, goroutines, interfaces, and Go-specific operators
 *
 * @param {string} text - The Go text to tokenize
 * @returns {string[]} An array of tokens
 */
function tokenizeGo(text) {
  let tokens = [];

  // Preserve comments for content analysis but mark them specially
  const commentPlaceholders = {};
  let commentCounter = 0;

  // Remove block comments first
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const placeholder = `__GO_COMMENT_BLOCK_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });

  // Remove line comments
  const withoutComments = withoutBlockComments.replace(
    /\/\/[^\n]*/g,
    (match) => {
      const placeholder = `__GO_COMMENT_LINE_${commentCounter++}__`;
      commentPlaceholders[placeholder] = match;
      return placeholder;
    }
  );

  // Handle string literals and placeholders
  const stringPlaceholders = {};
  let placeholderCounter = 0;

  // Handle raw string literals with backticks
  const withoutRawStrings = withoutComments.replace(/`[^`]*`/g, (match) => {
    const placeholder = `__GO_RAW_STRING_${placeholderCounter++}__`;
    stringPlaceholders[placeholder] = match;
    return placeholder;
  });

  // Handle regular string literals
  const withoutStrings = withoutRawStrings.replace(
    /"(?:[^"\\]|\\.)*"/g,
    (match) => {
      const placeholder = `__GO_STRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );

  // Handle rune literals
  const withoutRunes = withoutStrings.replace(/'(?:[^'\\]|\\.)*'/g, (match) => {
    const placeholder = `__GO_RUNE_${placeholderCounter++}__`;
    stringPlaceholders[placeholder] = match;
    return placeholder;
  });

  // Handle struct tags in field definitions
  // These are special string literals used for annotations in struct fields
  const withoutStructTags = withoutRunes.replace(
    /`(?:[a-zA-Z0-9_]+:"[^"]*")+`/g,
    (match) => {
      const placeholder = `__GO_STRUCT_TAG_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;

      // Process struct tag content to extract key information
      tokens.push("struct_tag");

      // Extract tag keys and values
      const tagPairs = match.slice(1, -1).split(" "); // Remove backticks and split by space
      for (const pair of tagPairs) {
        if (!pair.trim()) continue;

        // Split by colon and extract key/value
        const [key, quotedValue] = pair.split(":");
        if (key && quotedValue) {
          tokens.push(`tag_${key}`);

          // Extract value without quotes
          const value = quotedValue.replace(/^"|"$/g, "");
          if (value) {
            // If it's a comma-separated list, add each part
            if (value.includes(",")) {
              const valueParts = value.split(",");
              tokens.push(...valueParts);
            } else {
              tokens.push(value);
            }
          }
        }
      }

      return placeholder;
    }
  );

  // Handle Go channel operations (<-, ->)
  const withoutChannelOps = withoutStructTags.replace(/<-/g, (match) => {
    tokens.push("channel_operation");
    return " <- "; // Space-separated for tokenization
  });

  // Handle goroutines (go keyword followed by function call or func literal)
  const withoutGoroutines = withoutChannelOps.replace(
    /\bgo\s+(?:func\b|[a-zA-Z_][a-zA-Z0-9_]*\s*\()/g,
    (match) => {
      tokens.push("goroutine");

      // Extract function name if it's a function call
      const funcCallMatch = match.match(/go\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (funcCallMatch && funcCallMatch[1]) {
        tokens.push(funcCallMatch[1]);
      }

      return match;
    }
  );

  // Handle select statement with cases
  const withoutSelect = withoutGoroutines.replace(
    /\bselect\s*{[\s\S]*?}/g,
    (match) => {
      tokens.push("select_statement");

      // Extract cases
      const cases = match.match(/case\s+[^:]+:/g);
      if (cases) {
        for (const caseStr of cases) {
          // Tokenize case content
          const caseContent = caseStr.slice(4, -1).trim(); // Remove "case" and ":"
          const caseTokens = tokenizeGeneric(caseContent);
          tokens.push(...caseTokens);
        }
      }

      return match;
    }
  );

  // Handle defer statements
  const withoutDefer = withoutSelect.replace(
    /\bdefer\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g,
    (match) => {
      tokens.push("defer");

      // Extract function name
      const funcMatch = match.match(/defer\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (funcMatch && funcMatch[1]) {
        tokens.push(funcMatch[1]);
      }

      return match;
    }
  );

  // Handle type declarations with interfaces and structs
  const withoutTypeDecls = withoutDefer.replace(
    /\btype\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:struct|interface)\s*{[\s\S]*?}/g,
    (match, typeName) => {
      tokens.push("type_declaration");
      tokens.push(typeName);

      // Check if it's a struct or interface
      if (match.includes("struct")) {
        tokens.push("struct_type");

        // Extract field names and types
        const fieldMatches = match.match(
          /([a-zA-Z_][a-zA-Z0-9_]*)\s+([a-zA-Z_][a-zA-Z0-9_.*[\]]*)/g
        );
        if (fieldMatches) {
          for (const fieldMatch of fieldMatches) {
            const parts = fieldMatch.trim().split(/\s+/);
            if (parts.length >= 2) {
              tokens.push(parts[0]); // Field name
              tokens.push(parts[1]); // Field type
            }
          }
        }
      } else if (match.includes("interface")) {
        tokens.push("interface_type");

        // Extract method signatures
        const methodMatches = match.match(
          /([a-zA-Z_][a-zA-Z0-9_]*)\s*\([\s\S]*?\)(?:\s*\([\s\S]*?\))?\s*[,{]/g
        );
        if (methodMatches) {
          for (const methodMatch of methodMatches) {
            const methodName = methodMatch.match(/([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (methodName && methodName[1]) {
              tokens.push(methodName[1]);
            }
          }
        }
      }

      return match;
    }
  );

  // Handle Go-specific builtins
  let withBuiltins = withoutTypeDecls;
  const goBuiltins = [
    "make",
    "new",
    "len",
    "cap",
    "append",
    "copy",
    "delete",
    "close",
    "complex",
    "real",
    "imag",
    "panic",
    "recover",
  ];

  for (const builtin of goBuiltins) {
    const regex = new RegExp(`\\b${builtin}\\s*\\(`, "g");
    withBuiltins = withBuiltins.replace(regex, (match) => {
      tokens.push(`builtin_${builtin}`);
      return match;
    });
  }

  // Add Go keywords and common patterns
  const goKeywords = [
    "package",
    "import",
    "func",
    "return",
    "var",
    "const",
    "type",
    "struct",
    "interface",
    "map",
    "chan",
    "go",
    "select",
    "case",
    "default",
    "defer",
    "if",
    "else",
    "switch",
    "for",
    "range",
    "continue",
    "break",
    "fallthrough",
    "goto",
    "nil",
    "iota",
    "true",
    "false",
  ];

  for (const keyword of goKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, "g");
    if (regex.test(withBuiltins)) {
      tokens.push(keyword);
    }
  }

  // Process the remaining text with generic tokenization
  const genericTokens = tokenizeGeneric(withBuiltins);
  tokens.push(...genericTokens);

  // Handle camelCase for method names which is common in Go
  const processedTokens = [];
  for (const token of tokens) {
    // Skip placeholders
    if (token.startsWith("__GO_")) {
      processedTokens.push(token);
      continue;
    }

    processedTokens.push(token);

    // Split camelCase
    if (/[a-z][A-Z]/.test(token)) {
      const parts = token
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(" ");
      if (parts.length > 1) {
        processedTokens.push(...parts);
      }
    }
  }

  // Replace placeholders with their original values and process content
  const finalTokens = [];
  for (const token of processedTokens) {
    if (stringPlaceholders[token]) {
      if (token.startsWith("__GO_STRING_")) {
        finalTokens.push("string_literal");

        // Extract and tokenize string content
        const content = stringPlaceholders[token];
        // Remove quotes and tokenize content
        const strContent = content.slice(1, -1);

        // Only tokenize non-empty content
        if (strContent.trim().length > 0) {
          const contentTokens = tokenizeGeneric(strContent);
          finalTokens.push(...contentTokens);
        }
      } else if (token.startsWith("__GO_RAW_STRING_")) {
        finalTokens.push("raw_string_literal");

        // Extract content from raw string
        const content = stringPlaceholders[token];
        // Remove backticks
        const rawContent = content.slice(1, -1);

        // Handle multiline raw strings specially
        if (rawContent.includes("\n")) {
          // Process each line separately
          const lines = rawContent.split("\n");
          for (const line of lines) {
            if (line.trim()) {
              const lineTokens = tokenizeGeneric(line.trim());
              finalTokens.push(...lineTokens);
            }
          }
        } else if (rawContent.trim()) {
          const contentTokens = tokenizeGeneric(rawContent);
          finalTokens.push(...contentTokens);
        }
      } else if (token.startsWith("__GO_STRUCT_TAG_")) {
        finalTokens.push("struct_tag");
      } else if (token.startsWith("__GO_RUNE_")) {
        finalTokens.push("rune_literal");
      } else {
        finalTokens.push(token);
      }
    } else if (commentPlaceholders[token]) {
      // Extract useful keywords from comments
      finalTokens.push("code_comment");

      // Extract possible important terms from comments
      const commentContent = commentPlaceholders[token]
        .replace(/^\/\*|\*\/$/g, "") // Remove /* */
        .replace(/^\/\//g, ""); // Remove //

      // Only use alphanumeric words from comments, skip punctuation and symbols
      const commentTokens = commentContent
        .split(/\s+/)
        .filter((word) => /^[a-z0-9_]{3,}$/i.test(word))
        .map((word) => word.toLowerCase());

      finalTokens.push(...commentTokens);
    } else {
      finalTokens.push(token);
    }
  }

  return [...new Set(finalTokens)]; // Remove duplicates
}

/**
 * Simple word stemming function that handles common suffixes
 *
 * @param {string} word - The word to stem
 * @returns {string} The stemmed word
 */
export function stem(word) {
  // Make sure input is a string and lowercase
  if (typeof word !== "string") return "";
  const lowerWord = word.toLowerCase();

  // Handle empty strings
  if (lowerWord.length <= 2) return lowerWord;

  // Simple suffix removal rules
  if (lowerWord.endsWith("ing")) {
    // ending -> end, running -> run
    const stemmed = lowerWord.slice(0, -3);
    if (stemmed.length > 2) return stemmed;
    return lowerWord;
  }

  if (lowerWord.endsWith("ed")) {
    // ended -> end, created -> creat
    const stemmed = lowerWord.slice(0, -2);
    if (stemmed.length > 2) return stemmed;
    return lowerWord;
  }

  if (lowerWord.endsWith("s") && !lowerWord.endsWith("ss")) {
    // files -> file, classes -> class
    return lowerWord.slice(0, -1);
  }

  if (lowerWord.endsWith("es")) {
    // classes -> class, boxes -> box
    return lowerWord.slice(0, -2);
  }

  if (lowerWord.endsWith("ly")) {
    // quickly -> quick
    return lowerWord.slice(0, -2);
  }

  if (lowerWord.endsWith("er")) {
    // faster -> fast
    return lowerWord.slice(0, -2);
  }

  // Default: return word as is
  return lowerWord;
}
