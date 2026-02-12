import type {ContextFileContent} from '../../core/interfaces/context-tree/i-context-file-reader.js'

import {CogitPushContext} from '../../core/domain/entities/cogit-push-context.js'

/**
 * Parameters for mapping context files to push contexts.
 */
export type MapToPushContextsParams = {
  /** Files to be added (new files) */
  addedFiles: ContextFileContent[]
  /** Paths of files to be deleted (only path needed, files no longer exist) */
  deletedPaths: string[]
  /** Files to be edited (modified files) */
  modifiedFiles: ContextFileContent[]
}

/**
 * Maps context file contents to CogitPushContext instances for the CoGit API.
 * Converts file reader output to the format expected by the push service.
 *
 * @param params - The mapping parameters containing files to process
 * @returns Array of CogitPushContext instances ready for the push API
 */
export const mapToPushContexts = (params: MapToPushContextsParams): CogitPushContext[] => {
  const addedContextFiles = params.addedFiles.map(
    (file) =>
      new CogitPushContext({
        content: file.content,
        operation: 'add',
        path: file.path,
        tags: file.tags,
        title: file.title,
      }),
  )

  const editedContextFiles = params.modifiedFiles.map(
    (file) =>
      new CogitPushContext({
        content: file.content,
        operation: 'edit',
        path: file.path,
        tags: file.tags,
        title: file.title,
      }),
  )

  const deletedContextFiles = params.deletedPaths.map(
    (deletedPath) =>
      new CogitPushContext({
        content: '',
        operation: 'delete',
        path: deletedPath,
        tags: [],
        title: '',
      }),
  )

  return [...addedContextFiles, ...editedContextFiles, ...deletedContextFiles]
}
