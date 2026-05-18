import {isAbsolute, relative, resolve} from 'node:path'

import type {PermissionOption} from '../../../shared/types/channel.js'

// Phase 10 Tier B2 (V6 run-2/run-3 §3b) — auto-approve "empty-oldText Edit"
// permission requests when the target file is inside the project sandbox.
//
// Why: when codex (and other drivers) re-write a file they own with the
// Edit tool, the diff carries an EMPTY `oldText` and the full file as
// `newText`. That's semantically a Write, but the permission boundary
// treats it as an Edit and gates it behind a human decision. Across
// V6 run-2 + run-3 this cost ~15 minutes of orchestrator wall-clock
// per build for an operation that's structurally identical to the
// initial Write the agent already had permission to perform.
//
// Safety constraints (must ALL hold to auto-approve):
//   1. toolCall.kind === 'edit'
//   2. every diff edit in the request has empty `oldText`
//      (a partial-replacement edit still gates as usual)
//   3. every target path resolves WITHIN the project sandbox
//      (no `..` escape, no absolute path outside projectRoot)
//   4. the request options include an `allow_once` choice
//
// If any check fails → return undefined → orchestrator falls through to
// the human-decision path. The detector is intentionally conservative:
// false negatives are fine (extra gate is annoying but safe); false
// positives could bypass an intentional Edit-protected file.

export type AutoApproveDecision = {
  readonly optionId: string
  readonly reason: string
}

type DiffPayload = {
  readonly diff?: {
    readonly newText?: unknown
    readonly oldText?: unknown
    readonly path?: unknown
  }
  readonly newText?: unknown
  readonly oldText?: unknown
  readonly path?: unknown
  readonly type?: unknown
}

export type AutoApprovalArgs = {
  readonly options: ReadonlyArray<PermissionOption>
  readonly projectRoot: string
  readonly toolCall: unknown
}

// eslint-disable-next-line complexity
export function decideAutoApprovalForEditAsWrite(args: AutoApprovalArgs): AutoApproveDecision | undefined {
  const {options, projectRoot, toolCall} = args
  if (typeof toolCall !== 'object' || toolCall === null) return undefined
  const tc = toolCall as {content?: unknown; kind?: unknown; locations?: unknown}
  if (tc.kind !== 'edit') return undefined

  // Collect every diff-shaped content entry. Drivers vary: some embed the
  // diff fields at the top level (`{type: 'diff', oldText: '', newText: '…'}`),
  // others nest under `.diff` (`{type: 'diff', diff: {oldText: '', newText: '…'}}`).
  const content = Array.isArray(tc.content) ? tc.content : []
  if (content.length === 0) return undefined

  const diffs: DiffPayload[] = content.filter((c): c is DiffPayload =>
    typeof c === 'object' && c !== null,
  )
  if (diffs.length === 0) return undefined

  for (const entry of diffs) {
    const oldText = entry.diff?.oldText ?? entry.oldText
    if (typeof oldText !== 'string' || oldText.length > 0) {
      // Any non-empty-oldText entry disqualifies the whole request.
      return undefined
    }

    const newText = entry.diff?.newText ?? entry.newText
    if (typeof newText !== 'string' || newText.length === 0) {
      // Edit with both old and new empty isn't a Write-equivalent.
      return undefined
    }

    const rawPath = entry.diff?.path ?? entry.path
    if (typeof rawPath !== 'string' || rawPath.length === 0) {
      return undefined
    }

    if (!isWithinProjectRoot(rawPath, projectRoot)) {
      return undefined
    }
  }

  // At least one allow-flavoured option must be in the request, otherwise
  // we can't auto-resolve.
  const allowOption = options.find(o => o.kind === 'allow_once' || o.kind === 'allow_always')
  if (allowOption === undefined) return undefined

  return {
    optionId: allowOption.optionId,
    reason: `empty-oldText Edit on sandboxed project file(s); auto-approved as Write-equivalent`,
  }
}

function isWithinProjectRoot(targetPath: string, projectRoot: string): boolean {
  const root = resolve(projectRoot)
  const target = resolve(targetPath)
  const rel = relative(root, target)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  // Reject absolute drift (e.g. on Windows when paths cross drives, relative
  // returns an absolute path).
  return !isAbsolute(rel)
}
