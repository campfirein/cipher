import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * Input schema for edit file tool.
 */
const EditFileInputSchema = z
  .object({
    filePath: z.string().describe('Absolute path to the file to edit'),
    newString: z.string().describe('Replacement text'),
    oldString: z.string().describe('Text to replace (must be unique unless replaceAll is true)'),
    replaceAll: z
      .boolean()
      .optional()
      .default(false)
      .describe('Replace all occurrences (default: false, requires unique match)'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type EditFileInput = z.infer<typeof EditFileInputSchema>

/**
 * Creates the edit file tool.
 *
 * Edits a file by replacing text.
 * By default, requires oldString to be unique (only one occurrence).
 * Set replaceAll to true to replace all occurrences.
 *
 * @param fileSystemService - File system service dependency
 * @returns Configured edit file tool
 */
export function createEditFileTool(fileSystemService: IFileSystem): Tool {
  return {
    description:
      'Edit a file by replacing text. By default requires unique match (set replaceAll=true for multiple replacements).',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {filePath, newString, oldString, replaceAll} = input as EditFileInput

      // Call file system service
      const result = await fileSystemService.editFile(
        filePath,
        {
          newString,
          oldString,
          replaceAll,
        },
        {},
      )

      // Return formatted result
      return {
        bytesWritten: result.bytesWritten,
        path: result.path,
        replacements: result.replacements,
        success: result.success,
      }
    },
    id: ToolName.EDIT_FILE,
    inputSchema: EditFileInputSchema,
  }
}