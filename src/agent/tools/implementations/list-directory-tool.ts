import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../types/tools/types.js'
import type {IFileSystem} from '../../interfaces/i-file-system.js'

import {ToolName} from '../../types/tools/constants.js'

/**
 * Input schema for list directory tool.
 */
const ListDirectoryInputSchema = z
  .object({
    ignore: z
      .array(z.string())
      .optional()
      .describe('Additional glob patterns to ignore (e.g., ["*.log", "temp/"])'),
    maxResults: z
      .number()
      .int()
      .positive()
      .optional()
      .default(100)
      .describe('Maximum number of files to return (default: 100)'),
    path: z
      .string()
      .optional()
      .describe('The absolute path to the directory to list (defaults to working directory)'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type ListDirectoryInput = z.infer<typeof ListDirectoryInputSchema>

/**
 * Creates the list directory tool.
 *
 * Lists files and directories in a tree structure.
 * Automatically ignores common build artifacts and caches.
 *
 * @param fileSystemService - File system service dependency
 * @returns Configured list directory tool
 */
export function createListDirectoryTool(fileSystemService: IFileSystem): Tool {
  return {
    description:
      'Lists files and directories in a tree structure. Automatically ignores common build artifacts (node_modules, dist, .git, etc.).',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {ignore, maxResults, path} = input as ListDirectoryInput

      const result = await fileSystemService.listDirectory(path ?? '.', {
        ignore,
        maxResults,
      })

      return {
        count: result.count,
        tree: result.tree,
        truncated: result.truncated,
      }
    },
    id: ToolName.LIST_DIRECTORY,
    inputSchema: ListDirectoryInputSchema,
  }
}
