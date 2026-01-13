/**
 * Maximum concurrent curate tasks.
 *
 * Set to 1 (sequential execution) to prevent:
 * - File conflicts when multiple curate tasks write to the same knowledge files
 * - Race conditions in context tree updates
 * - LLM context confusion when parallel curations overlap
 *
 * Trade-off: Slightly slower throughput for multiple curate commands,
 * but significantly more reliable knowledge curation.
 */
export const CURATE_MAX_CONCURRENT = 1
