import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * Input schema for grep content tool.
 */
const GrepContentInputSchema = z
  .object({
    caseInsensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe('Perform case-insensitive search (default: false)'),
    contextLines: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe('Number of context lines to include before and after each match (default: 0)'),
    glob: z.string().optional().describe('Glob pattern to filter files (e.g., "*.ts", "**/*.js")'),
    maxResults: z
      .number()
      .int()
      .positive()
      .optional()
      .default(100)
      .describe('Maximum number of results to return (default: 100)'),
    path: z.string().optional().describe('Directory to search in (defaults to working directory)'),
    pattern: z.string().describe('Regular expression pattern to search for'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type GrepContentInput = z.infer<typeof GrepContentInputSchema>

/**
 * Creates the grep content tool.
 *
 * Searches file contents for a regex pattern.
 * Can filter files with glob patterns and include context lines.
 *
 * @param fileSystemService - File system service dependency
 * @returns Configured grep content tool
 */
export function createGrepContentTool(fileSystemService: IFileSystem): Tool {
  return {
    description:
      'Search file contents for a regex pattern. Can filter files with glob patterns and include context lines around matches.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {caseInsensitive, contextLines, glob, maxResults, path, pattern} = input as GrepContentInput

      // Call file system service
      const result = await fileSystemService.searchContent(pattern, {
        caseInsensitive,
        contextLines,
        cwd: path,
        globPattern: glob,
        maxResults,
      })

      // Format matches
      const matches = result.matches.map((match) => ({
        context: match.context
          ? {
              after: match.context.after,
              before: match.context.before,
            }
          : undefined,
        file: match.file,
        line: match.line,
        lineNumber: match.lineNumber,
      }))

      // Return formatted result
      return {
        filesSearched: result.filesSearched,
        matches,
        totalMatches: result.totalMatches,
        truncated: result.truncated,
      }
    },
    id: ToolName.GREP_CONTENT,
    inputSchema: GrepContentInputSchema,
  }
}