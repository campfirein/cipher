/**
 * Sandbox constants for code execution security.
 * Following design patterns from rlm/rlm/environments/local_repl.py
 */

/**
 * Safe globals allowed in sandbox.
 * These are standard JavaScript built-ins that are safe for sandboxed execution.
 */
export const ALLOWED_GLOBALS = [
  // Console (custom safe version that captures output)
  'console',

  // Core constructors
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'BigInt',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Date',
  'RegExp',
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
  'AggregateError',
  'Promise',
  'Proxy',
  'Reflect',

  // Math and JSON
  'Math',
  'JSON',
  'Intl',

  // Typed Arrays
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',

  // Utilities
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURI',
  'decodeURI',
  'encodeURIComponent',
  'decodeURIComponent',
  'atob',
  'btoa',

  // Timing (will use safe wrapped versions)
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',

  // Other safe globals
  'NaN',
  'Infinity',
  'undefined',
] as const

/**
 * Explicitly blocked globals for security.
 * These are NOT available in the sandbox.
 */
export const BLOCKED_GLOBALS = [
  'eval', // Dynamic code execution
  'Function', // Can be used like eval
  'require', // Module loading
  'import', // Module loading
  'process', // Node.js process object
  'global', // Global object access
  'globalThis', // Global object access
  '__dirname', // File system info
  '__filename', // File system info
  'Buffer', // Can be used for exploits
  'fetch', // Network access
  'XMLHttpRequest', // Network access
  'WebSocket', // Network access
] as const

/**
 * Default timeout for sandbox execution (30 seconds).
 */
export const DEFAULT_SANDBOX_TIMEOUT = 30_000

/**
 * Maximum timeout for sandbox execution (5 minutes).
 */
export const MAX_SANDBOX_TIMEOUT = 300_000

/**
 * Whitelisted packages available in sandbox.
 * Focused on data processing and computation (no file system access).
 */
export const ALLOWED_PACKAGES = [
  // Data manipulation & utilities
  'lodash', // General utilities (map, filter, groupBy, etc.)
  'ramda', // Functional programming utilities

  // String & regex processing
  'change-case', // Case conversion (camelCase, snakeCase, etc.)
  'pluralize', // Pluralization
  'escape-string-regexp', // Escape regex special characters
  'slugify', // URL slug generation

  // Pattern matching (in-memory, not file-based)
  'minimatch', // Glob pattern matching for strings
  'micromatch', // Advanced glob matching

  // Data validation & transformation
  'zod', // Schema validation
  'validator', // String validation (isEmail, isURL, etc.)
  'json5', // JSON with comments support
  'yaml', // YAML parsing

  // Date/time
  'date-fns', // Date manipulation
  'dayjs', // Lightweight date library

  // Math & computation
  'mathjs', // Advanced math operations
  'decimal.js', // Arbitrary precision decimals

  // ID generation
  'uuid', // UUID generation
  'nanoid', // Compact ID generation
] as const
