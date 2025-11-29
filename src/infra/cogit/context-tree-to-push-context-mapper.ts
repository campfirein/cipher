import type {ContextFileContent} from '../../core/interfaces/i-context-file-reader.js'

import {CogitPushContext} from '../../core/domain/entities/cogit-push-context.js'

/**
 * Parameters for mapping context files to push contexts.
 */
export type MapToPushContextsParams = {
  /** Files to be added (new files) */
  addedFiles: ContextFileContent[]
  // Future: modifiedFiles, deletedPaths for edit/delete operations
}

/**
 * Maps context file contents to CogitPushContext instances for the CoGit API.
 * Converts file reader output to the format expected by the push service.
 *
 * @param params - The mapping parameters containing files to process
 * @returns Array of CogitPushContext instances ready for the push API
 */
export const mapToPushContexts = (params: MapToPushContextsParams): CogitPushContext[] =>
  params.addedFiles.map(
    (file) =>
      new CogitPushContext({
        content: file.content,
        operation: 'add',
        path: file.path,
        tags: [],
        title: file.title,
      }),
  )
