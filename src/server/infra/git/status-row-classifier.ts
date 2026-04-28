import type {ChangedFile, GitStatusFile} from '../../core/interfaces/services/i-git-service.js'

import {GitError} from '../../core/domain/errors/git-error.js'

/** Status entry projected to status() output. The caller adds `path`. */
export type StatusEntry = Pick<GitStatusFile, 'staged' | 'status'>

/**
 * Classification of a single statusMatrix row's `[head, workdir, stage]` tuple,
 * shared across every consumer of `git.statusMatrix`. Five sites used to derive
 * their own dirty/staged/diff projections from raw column comparisons; that
 * divergence is what produced the `[1,1,3]` deadlock (status whitelist missed
 * the tuple, pull's generic filter caught it). Routing every consumer through
 * this single classifier guarantees they all agree on what each tuple means.
 */
export type RowClassification = {
  /** True for any tuple other than `[1,1,1]`. Drives `status.isClean` and `pull`'s overwrite check. */
  dirty: boolean
  /**
   * Status entries for `status()` output, in the order parseMatrix used to push
   * them. The caller attaches the path. 0-2 entries per row.
   */
  files: StatusEntry[]
  /** True when `stage !== head`. Drives `guardStagedConflicts` and `resetUnstage`. */
  staged: boolean
  /** HEAD→STAGE diff for `brv vc diff --staged`. Undefined when stage matches HEAD. */
  stagedDiff?: ChangedFile['status']
  /** STAGE→WORKDIR diff for `brv vc diff` (default). Undefined when workdir matches stage. */
  unstagedDiff?: ChangedFile['status']
}

/**
 * Classify a `[head, workdir, stage]` tuple from `git.statusMatrix`.
 *
 * Throws on tuples outside the known-reachable set so future isomorphic-git
 * encoding changes surface as test failures rather than silent drops.
 */
// eslint-disable-next-line complexity
export function classifyTuple(head: number, workdir: number, stage: number): RowClassification {
  if (head === 1 && workdir === 1 && stage === 1) {
    return {dirty: false, files: [], staged: false}
  }

  if (head === 0 && workdir === 2 && stage === 0) {
    // [0,2,0] untracked new file
    return {dirty: true, files: [{staged: false, status: 'untracked'}], staged: false}
  }

  if (head === 0 && workdir === 2 && stage === 2) {
    // [0,2,2] staged new file
    return {dirty: true, files: [{staged: true, status: 'added'}], staged: true, stagedDiff: 'added'}
  }

  if (head === 0 && workdir === 2 && stage === 3) {
    // [0,2,3] partially staged new file (also "both added" during merge)
    return {
      dirty: true,
      files: [
        {staged: true, status: 'added'},
        {staged: false, status: 'modified'},
      ],
      staged: true,
      stagedDiff: 'added',
      unstagedDiff: 'modified',
    }
  }

  if (head === 0 && workdir === 0 && stage === 3) {
    // [0,0,3] staged a brand-new file then deleted it from disk. Native git shows
    // both the staged add and an unstaged delete on top.
    return {
      dirty: true,
      files: [
        {staged: true, status: 'added'},
        {staged: false, status: 'deleted'},
      ],
      staged: true,
      stagedDiff: 'added',
      unstagedDiff: 'deleted',
    }
  }

  if (head === 1 && workdir === 0 && stage === 0) {
    // [1,0,0] staged deletion (git rm)
    return {dirty: true, files: [{staged: true, status: 'deleted'}], staged: true, stagedDiff: 'deleted'}
  }

  if (head === 1 && workdir === 0 && stage === 1) {
    // [1,0,1] unstaged deletion (rm without git rm)
    return {dirty: true, files: [{staged: false, status: 'deleted'}], staged: false, unstagedDiff: 'deleted'}
  }

  if (head === 1 && workdir === 0 && stage === 2) {
    // [1,0,2] absent from disk, index differs from HEAD (e.g. post-merge-conflict)
    return {
      dirty: true,
      files: [{staged: false, status: 'deleted'}],
      staged: true,
      stagedDiff: 'modified',
      unstagedDiff: 'deleted',
    }
  }

  if (head === 1 && workdir === 0 && stage === 3) {
    // [1,0,3] staged modification then deleted from disk
    return {
      dirty: true,
      files: [
        {staged: true, status: 'modified'},
        {staged: false, status: 'deleted'},
      ],
      staged: true,
      stagedDiff: 'modified',
      unstagedDiff: 'deleted',
    }
  }

  if (head === 1 && workdir === 1 && stage === 0) {
    // [1,1,0] git rm --cached: staged deletion + file still in workdir → untracked
    return {
      dirty: true,
      files: [
        {staged: true, status: 'deleted'},
        {staged: false, status: 'untracked'},
      ],
      staged: true,
      stagedDiff: 'deleted',
    }
  }

  if (head === 1 && workdir === 2 && stage === 0) {
    // [1,2,0] `git rm --cached` followed by a workdir edit. Native git treats this
    // identically to [1,1,0] — staged deletion plus untracked workdir file — because
    // the index no longer tracks the file regardless of what's on disk.
    return {
      dirty: true,
      files: [
        {staged: true, status: 'deleted'},
        {staged: false, status: 'untracked'},
      ],
      staged: true,
      stagedDiff: 'deleted',
    }
  }

  if (head === 1 && workdir === 1 && stage === 3) {
    // [1,1,3] workdir matches HEAD but index holds a divergent staged blob —
    // reachable via filesystem-only restore after `brv vc add` (editor undo,
    // AI agent revert, sync-tool rollback). Same tuple appears as the
    // "deleted_modified" merge conflict, but `getConflicts()` handles that
    // separately based on MERGE_HEAD presence.
    return {
      dirty: true,
      files: [{staged: true, status: 'modified'}],
      staged: true,
      stagedDiff: 'modified',
      unstagedDiff: 'modified',
    }
  }

  if (head === 1 && workdir === 2 && stage === 1) {
    // [1,2,1] unstaged modification
    return {dirty: true, files: [{staged: false, status: 'modified'}], staged: false, unstagedDiff: 'modified'}
  }

  if (head === 1 && workdir === 2 && stage === 2) {
    // [1,2,2] staged modification
    return {dirty: true, files: [{staged: true, status: 'modified'}], staged: true, stagedDiff: 'modified'}
  }

  if (head === 1 && workdir === 2 && stage === 3) {
    // [1,2,3] partially staged modification (also "both modified" during merge)
    return {
      dirty: true,
      files: [
        {staged: true, status: 'modified'},
        {staged: false, status: 'modified'},
      ],
      staged: true,
      stagedDiff: 'modified',
      unstagedDiff: 'modified',
    }
  }

  throw new GitError(
    `Unknown statusMatrix tuple [${head},${workdir},${stage}]; isomorphic-git may have introduced a new encoding`,
  )
}
