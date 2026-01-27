/**
 * Path utilities for context tree operations.
 *
 * Provides cross-platform path normalization to ensure all context tree paths
 * use forward slashes regardless of the operating system.
 */

export {normalizeForComparison as toUnixPath} from '../../../agent/infra/process/path-utils.js'
