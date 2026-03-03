import type {ContextFileContent} from '../../core/interfaces/context-tree/i-context-file-reader.js'

import {CogitPushContext} from '../../core/domain/entities/cogit-push-context.js'

/**
 * Review metadata for a single context file, derived from the curate log.
 */
export type ContextReviewMetadata = {
  confidence: 'high' | 'low'
  impact: 'high' | 'low' | 'medium'
  needsReview: boolean
  reason: string
}

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
  /**
   * Optional review metadata keyed by file path (relative to context tree root).
   * When present, used to set needsReview, confidence, impact, and reason on push contexts.
   */
  reviewMetadata?: Map<string, ContextReviewMetadata>
}

/** Default review metadata for deleted files — always flagged for review. */
const DELETED_FILE_DEFAULTS: ContextReviewMetadata = {
  confidence: 'high',
  impact: 'high',
  needsReview: true,
  reason: 'Deleted from context tree',
}

/**
 * Maps context file contents to CogitPushContext instances for the CoGit API.
 * Converts file reader output to the format expected by the push service.
 * Annotates contexts with review metadata when available in the curate log.
 *
 * @param params - The mapping parameters containing files to process
 * @returns Array of CogitPushContext instances ready for the push API
 */
export const mapToPushContexts = (params: MapToPushContextsParams): CogitPushContext[] => {
  const {addedFiles, deletedPaths, modifiedFiles, reviewMetadata} = params

  const addedContextFiles = addedFiles.map((file) => {
    const meta = reviewMetadata?.get(file.path)
    return new CogitPushContext({
      confidence: meta?.confidence,
      content: file.content,
      impact: meta?.impact,
      needsReview: meta?.needsReview,
      operation: 'add',
      path: file.path,
      reason: meta?.reason,
      tags: file.tags,
      title: file.title,
    })
  })

  const editedContextFiles = modifiedFiles.map((file) => {
    const meta = reviewMetadata?.get(file.path)
    return new CogitPushContext({
      confidence: meta?.confidence,
      content: file.content,
      impact: meta?.impact,
      needsReview: meta?.needsReview,
      operation: 'edit',
      path: file.path,
      reason: meta?.reason,
      tags: file.tags,
      title: file.title,
    })
  })

  const deletedContextFiles = deletedPaths.map((deletedPath) => {
    const meta = reviewMetadata?.get(deletedPath) ?? DELETED_FILE_DEFAULTS
    return new CogitPushContext({
      confidence: meta.confidence,
      content: '',
      impact: meta.impact,
      needsReview: meta.needsReview,
      operation: 'delete',
      path: deletedPath,
      reason: meta.reason,
      tags: [],
      title: '',
    })
  })

  return [...addedContextFiles, ...editedContextFiles, ...deletedContextFiles]
}
