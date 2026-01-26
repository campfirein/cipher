import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * Input schema for glob files tool.
 */
const GlobFilesInputSchema = z
  .object({
    caseSensitive: z
      .boolean()
      .optional()
      .default(true)
      .describe('Case-sensitive pattern matching (default: true)'),
    maxResults: z
      .number()
      .int()
      .positive()
      .optional()
      .default(1000)
      .describe('Maximum number of results to return (default: 1000)'),
    path: z.string().optional().describe('Base directory to search from (defaults to working directory)'),
    pattern: z.string().describe('Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")')
  })
  .strict()

/**
 * Input type derived from schema.
 */
type GlobFilesInput = z.infer<typeof GlobFilesInputSchema>

/**
 * Creates the glob files tool.
 *
 * Finds files matching a glob pattern.
 * Supports standard glob syntax with ** for recursive matching.
 *
 * Features:
 * - Case sensitivity control
 * - Gitignore filtering (respects .gitignore rules by default)
 * - Smart sorting: recently modified files (within 24h) appear first
 * - Handles file names containing glob special characters
 *
 * @param fileSystemService - File system service dependency
 * @returns Configured glob files tool
 */
export function createGlobFilesTool(fileSystemService: IFileSystem): Tool {
  return {
    description:
      'Find files matching a glob pattern. Supports ** for recursive matching (e.g., "**/*.ts" finds all TypeScript files)',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {caseSensitive, maxResults, path, pattern} = input as GlobFilesInput

      // Call file system service with new options
      const result = await fileSystemService.globFiles(pattern, {
        caseSensitive,
        cwd: path,
        includeMetadata: true,
        maxResults,
        respectGitignore: true,
      })

      // Format file metadata
      const files = result.files.map((file) => ({
        modified: file.modified.toISOString(),
        path: file.path,
        size: file.size,
      }))

      // Return formatted result with message for LLM context
      return {
        files,
        ignoredCount: result.ignoredCount,
        message: result.message,
        totalFound: result.totalFound,
        truncated: result.truncated,
      }
    },
    id: ToolName.GLOB_FILES,
    inputSchema: GlobFilesInputSchema,
  }
}