import type {VcDiffMode} from '../../../../../shared/transport/events/vc-events.js'

export function parseMode(arg: string | undefined, staged: boolean): VcDiffMode {
  if (staged && arg !== undefined) {
    throw new Error('--staged cannot be combined with a ref argument')
  }

  if (staged) return {kind: 'staged'}
  if (arg === undefined) return {kind: 'unstaged'}
  if (arg.includes('...')) {
    throw new Error("three-dot syntax is not supported; use 'a..b' for two-dot range")
  }

  const rangeMatch = /^(.+?)\.\.(.+)$/.exec(arg)
  if (rangeMatch) return {from: rangeMatch[1], kind: 'range', to: rangeMatch[2]}

  return {kind: 'ref-vs-worktree', ref: arg}
}
