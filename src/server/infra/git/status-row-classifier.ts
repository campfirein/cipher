import type {ChangedFile, GitStatusFile} from '../../core/interfaces/services/i-git-service.js'

import {GitError} from '../../core/domain/errors/git-error.js'

/** Status entry projected to status() output. The caller adds `path`. */
export type StatusEntry = Pick<GitStatusFile, 'staged' | 'status'>

/**
 * Classification of a single statusMatrix row's `[head, workdir, stage]` tuple,
 * shared across every consumer of `git.statusMatrix`. Six call sites used to
 * derive their own dirty/staged/diff projections from raw column comparisons;
 * routing every consumer through this single classifier is what guarantees
 * they all agree on what each tuple means.
 */
export type RowClassification = {
  /** True for any tuple other than `[1,1,1]`. Drives `status.isClean` and `pull`'s overwrite check. */
  dirty: boolean
  /**
   * Status entries for `status()` output. The caller attaches the path. 0-2
   * entries per row, ordered staged-first then unstaged.
   */
  files: StatusEntry[]
  /** True when `stage !== head`. Drives `guardStagedConflicts` and `resetUnstage`. */
  staged: boolean
  /** HEAD->INDEX diff for `brv vc diff --staged`. Undefined when INDEX matches HEAD. */
  stagedDiff?: ChangedFile['status']
  /** INDEX->WORKDIR diff for `brv vc diff` (default). Undefined when WORKDIR matches INDEX. */
  unstagedDiff?: ChangedFile['status']
}

type StagedDiff = ChangedFile['status'] | undefined
type UnstagedDiff = ChangedFile['status'] | undefined

/**
 * isomorphic-git statusMatrix encoding:
 *   HEAD    (h): 0 = absent,           1 = present
 *   WORKDIR (w): 0 = absent,           1 = matches HEAD,    2 = differs from HEAD
 *   STAGE   (s): 0 = absent,           1 = matches HEAD,    2 = matches WORKDIR,    3 = differs from both
 *
 * The XY columns native git derives from these are:
 *   staged column   = HEAD vs INDEX
 *   unstaged column = INDEX vs WORKDIR
 * The two helpers below project the encoding into those two columns.
 */
function stagedDiffFor(h: number, s: number): StagedDiff {
  if (h === 0 && s === 0) return undefined // not tracked anywhere
  if (h === 1 && s === 0) return 'deleted' // HEAD has it, INDEX doesn't
  if (h === 0) return 'added' // h=0, s>0
  if (s === 1) return undefined // INDEX matches HEAD, no staged change
  return 'modified' // h=1, s in {2,3}: INDEX differs from HEAD
}

function unstagedDiffFor(s: number, w: number): UnstagedDiff {
  if (s === 0) return undefined // INDEX absent: file is either gone or untracked, not a diff
  if (w === 0) return 'deleted' // s>0, WORKDIR absent: INDEX has a blob, disk does not
  // (s=2,w=0) is unreachable by the encoding (s=2 means INDEX==WORKDIR, so WORKDIR
  // absent forces INDEX absent => s=0); the w===0 guard above handles it safely either way.
  if (s === 2) return undefined // INDEX matches WORKDIR by definition
  if (s === 1 && w === 1) return undefined // INDEX=HEAD and WORKDIR=HEAD => INDEX=WORKDIR transitively
  return 'modified' // s=1,w=2  or  s=3,w>0
}

function validateEncoding(h: number, w: number, s: number): void {
  if (h !== 0 && h !== 1) {
    throw new GitError(`HEAD column out of range: ${h}; isomorphic-git encoding may have changed`)
  }

  if (w !== 0 && w !== 1 && w !== 2) {
    throw new GitError(`WORKDIR column out of range: ${w}; isomorphic-git encoding may have changed`)
  }

  if (s !== 0 && s !== 1 && s !== 2 && s !== 3) {
    throw new GitError(`STAGE column out of range: ${s}; isomorphic-git encoding may have changed`)
  }
}

/**
 * Classify a `[head, workdir, stage]` tuple from `git.statusMatrix` into the
 * shared projection. Total over the encoding's value range; throws only when
 * a column is outside that range, which is the cleanest signal that upstream
 * changed the encoding shape.
 */
export function classifyTuple(h: number, w: number, s: number): RowClassification {
  validateEncoding(h, w, s)

  const stagedDiff = stagedDiffFor(h, s)
  const unstagedDiff = unstagedDiffFor(s, w)
  const untracked = s === 0 && w > 0

  const files: StatusEntry[] = []
  if (stagedDiff) files.push({staged: true, status: stagedDiff})
  if (untracked) {
    files.push({staged: false, status: 'untracked'})
  } else if (unstagedDiff) {
    files.push({staged: false, status: unstagedDiff})
  }

  return {
    // Every tuple except clean [1,1,1]. Note: [0,0,0] (file absent everywhere) would
    // evaluate true here with files=[], but is unreachable in practice because
    // statusMatrix won't emit a row for a file absent from HEAD, INDEX, and WORKDIR.
    dirty: !(h === 1 && w === 1 && s === 1),
    files,
    staged: stagedDiff !== undefined,
    stagedDiff,
    unstagedDiff,
  }
}
