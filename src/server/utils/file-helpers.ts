/**
 * Sanitizes a folder path by replacing all special characters with a hyphen.
 * @param folderName - The folder path need to sanitize
 * @returns The sanitized folder path
 */
export function sanitizeFolderName(folderName: string): string {
  return folderName.replaceAll(/[^\w\-./]/g, '-');
}

/**
 * Converts a string to lowercase snake_case for file/folder naming.
 * Replaces spaces and special characters with underscores, converts to lowercase.
 * @param name - The name to convert
 * @returns The snake_case version of the name
 *
 * @example
 * ```ts
 * toSnakeCase('Best Practices') // => 'best_practices'
 * toSnakeCase('Error-Handling') // => 'error_handling'
 * toSnakeCase('QuickSort Optimizations') // => 'quicksort_optimizations'
 * ```
 */
export function toSnakeCase(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replaceAll(/[^\w]+/g, '_')
    .replaceAll(/_{2,}/g, '_')
    .replaceAll(/^_|_$/g, '');
}