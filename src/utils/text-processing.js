/**
 * Text processing utilities
 * Provides lightweight implementations of stemming and other text processing functions
 */

/**
 * Checks if a character is a vowel
 * @param {string} char - Character to check
 * @returns {boolean} True if the character is a vowel, false otherwise
 * @private
 */
const isVowel = (char) => {
  return ['a', 'e', 'i', 'o', 'u'].includes(char);
};

/**
 * Measures the number of consonant sequences in a word
 * Used in Porter stemmer algorithm to determine when to apply certain rules
 * @param {string} word - Word to measure
 * @returns {number} The number of consonant sequences
 * @private
 */
const measure = (word) => {
  // Replace the initial consonant or vowel sequences with single letters
  const simplified = word.replace(/^[^aeiou]+/, 'C')
                        .replace(/^[aeiou]+/, 'V')
                        .replace(/[^aeiou]+/g, 'C')
                        .replace(/[aeiou]+/g, 'V');
  
  // Count the CV pairs (consonant-vowel sequences)
  const matches = simplified.match(/CV/g);
  return matches ? matches.length : 0;
};

/**
 * Checks if a word contains a vowel
 * @param {string} word - Word to check
 * @returns {boolean} True if the word contains a vowel, false otherwise
 * @private
 */
const containsVowel = (word) => {
  return /[aeiou]/.test(word);
};

/**
 * Checks if a word ends with a double consonant
 * @param {string} word - Word to check
 * @returns {boolean} True if the word ends with a double consonant, false otherwise
 * @private
 */
const endsWithDoubleConsonant = (word) => {
  return word.length > 1 && 
         word[word.length - 1] === word[word.length - 2] && 
         !isVowel(word[word.length - 1]);
};

/**
 * Checks if a word ends with consonant-vowel-consonant pattern where the final consonant is not w, x, or y
 * @param {string} word - Word to check
 * @returns {boolean} True if the pattern is matched, false otherwise
 * @private
 */
const endsWithCVC = (word) => {
  if (word.length < 3) return false;
  
  const lastChar = word[word.length - 1];
  return !isVowel(word[word.length - 3]) && 
         isVowel(word[word.length - 2]) && 
         !isVowel(lastChar) && 
         !['w', 'x', 'y'].includes(lastChar);
};

/**
 * Applies Porter stemmer step 1a: simplify plural forms
 * @param {string} word - Word to process
 * @returns {string} Modified word
 * @private
 */
const step1a = (word) => {
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ies')) return word.slice(0, -2);
  if (word.endsWith('ss')) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
};

/**
 * Applies Porter stemmer step 1b: handle -ed and -ing endings
 * @param {string} word - Word to process
 * @returns {string} Modified word
 * @private
 */
const step1b = (word) => {
  let result = word;
  
  if (word.endsWith('eed')) {
    if (measure(word.slice(0, -3)) > 0) {
      result = word.slice(0, -1);
    }
  } else if (word.endsWith('ed') && containsVowel(word.slice(0, -2))) {
    result = word.slice(0, -2);
    return step1bPostProcess(result);
  } else if (word.endsWith('ing') && containsVowel(word.slice(0, -3))) {
    result = word.slice(0, -3);
    return step1bPostProcess(result);
  }
  
  return result;
};

/**
 * Post-processes words after removing -ed or -ing in step 1b
 * @param {string} word - Word to process
 * @returns {string} Modified word
 * @private
 */
const step1bPostProcess = (word) => {
  if (['at', 'bl', 'iz'].some(ending => word.endsWith(ending))) {
    return word + 'e';
  } else if (endsWithDoubleConsonant(word) && !['l', 's', 'z'].includes(word[word.length - 1])) {
    return word.slice(0, -1);
  } else if (measure(word) === 1 && endsWithCVC(word)) {
    return word + 'e';
  }
  return word;
};

/**
 * Applies Porter stemmer step 1c: -y endings
 * @param {string} word - Word to process
 * @returns {string} Modified word
 * @private
 */
const step1c = (word) => {
  if (word.endsWith('y') && containsVowel(word.slice(0, -1))) {
    return word.slice(0, -1) + 'i';
  }
  return word;
};

/**
 * Applies Porter stemmer step 2: handle common suffixes
 * @param {string} word - Word to process
 * @returns {string} Modified word
 * @private
 */
const step2 = (word) => {
  const suffixes = [
    ['ational', 'ate'],
    ['tional', 'tion'],
    ['enci', 'ence'],
    ['anci', 'ance'],
    ['izer', 'ize'],
    ['abli', 'able'],
    ['alli', 'al'],
    ['entli', 'ent'],
    ['eli', 'e'],
    ['ousli', 'ous'],
    ['ization', 'ize'],
    ['ation', 'ate'],
    ['ator', 'ate'],
    ['alism', 'al'],
    ['iveness', 'ive'],
    ['fulness', 'ful'],
    ['ousness', 'ous'],
    ['aliti', 'al'],
    ['iviti', 'ive'],
    ['biliti', 'ble']
  ];
  
  for (const [suffix, replacement] of suffixes) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) {
        return stem + replacement;
      }
      break;
    }
  }
  
  return word;
};

/**
 * Applies Porter stemmer step 3: more suffixes
 * @param {string} word - Word to process
 * @returns {string} Modified word
 * @private
 */
const step3 = (word) => {
  const suffixes = [
    ['icate', 'ic'],
    ['ative', ''],
    ['alize', 'al'],
    ['iciti', 'ic'],
    ['ical', 'ic'],
    ['ful', ''],
    ['ness', '']
  ];
  
  for (const [suffix, replacement] of suffixes) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) {
        return stem + replacement;
      }
      break;
    }
  }
  
  return word;
};

/**
 * Applies Porter stemmer step 4: long suffixes
 * @param {string} word - Word to process
 * @returns {string} Modified word
 * @private
 */
const step4 = (word) => {
  const suffixes = ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize'];
  
  for (const suffix of suffixes) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 1) {
        // Special case for 'ion'
        if (suffix === 'ion' && !['s', 't'].includes(stem[stem.length - 1])) {
          continue;
        }
        return stem;
      }
      break;
    }
  }
  
  return word;
};

/**
 * Applies Porter stemmer step 5a: e endings
 * @param {string} word - Word to process
 * @returns {string} Modified word
 * @private
 */
const step5a = (word) => {
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1);
    if (measure(stem) > 1 || (measure(stem) === 1 && !endsWithCVC(stem))) {
      return stem;
    }
  }
  return word;
};

/**
 * Applies Porter stemmer step 5b: double l endings
 * @param {string} word - Word to process
 * @returns {string} Modified word
 * @private
 */
const step5b = (word) => {
  if (word.endsWith('ll') && measure(word) > 1) {
    return word.slice(0, -1);
  }
  return word;
};

/**
 * Stems a word using a simplified Porter stemmer algorithm
 * Reduces words to their base/root form by removing common suffixes
 * @param {string} word - Word to stem
 * @returns {string} The stemmed word
 */
export const stem = (word) => {
  if (word.length < 3) return word.toLowerCase();
  
  let result = word.toLowerCase();
  result = step1a(result);
  result = step1b(result);
  result = step1c(result);
  result = step2(result);
  result = step3(result);
  result = step4(result);
  result = step5a(result);
  result = step5b(result);
  
  return result;
};

/**
 * Generates n-grams from an array of tokens
 * @param {string[]} tokens - Array of strings (words/tokens)
 * @param {number} n - Size of n-grams to generate (e.g., 2 for bigrams, 3 for trigrams)
 * @returns {string[]} Array of n-grams (strings joined by spaces)
 */
export const generateNgrams = (tokens, n) => {
  // Handle edge cases
  if (!tokens || tokens.length === 0) return [];
  if (n <= 0) return [];
  if (tokens.length < n) return [tokens.join(' ')];
  
  const ngrams = [];
  
  // Generate n-grams by sliding a window of size n over the tokens array
  for (let i = 0; i <= tokens.length - n; i++) {
    const ngram = tokens.slice(i, i + n).join(' ');
    ngrams.push(ngram);
  }
  
  return ngrams;
};

/**
 * Calculates Term Frequency (TF) for a given array of tokens
 * TF is defined as count of token / total number of tokens in the document
 * @param {string[]} tokens - Array of strings (words/tokens) representing a document
 * @returns {Object.<string, number>} Object where keys are unique tokens and values are their term frequencies
 */
const calculateTF = (tokens) => {
  if (!tokens || tokens.length === 0) {
    return {};
  }

  const frequencies = {};
  const totalTokens = tokens.length;

  // Count occurrences of each token
  for (const token of tokens) {
    frequencies[token] = (frequencies[token] || 0) + 1;
  }

  // Calculate term frequencies (count / total)
  const termFrequencies = {};
  for (const [token, count] of Object.entries(frequencies)) {
    termFrequencies[token] = count / totalTokens;
  }

  return termFrequencies;
};

export { stem, generateNgrams, calculateTF };
export default stem;
