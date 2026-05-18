import {expect} from 'chai'

import type {PermissionOption} from '../../../../../src/shared/types/channel.js'

import {decideAutoApprovalForEditAsWrite} from '../../../../../src/server/infra/channel/permission-auto-approver.js'

const allowOnce: PermissionOption = {kind: 'allow_once', name: 'Yes', optionId: 'approved'}
const rejectOnce: PermissionOption = {kind: 'reject_once', name: 'No', optionId: 'abort'}
const PROJECT_ROOT = '/Users/me/proj'

// Helper: build a codex-style toolCall payload with the inline diff shape
// observed in V6 (`{type: 'diff', path, oldText, newText}` at the content
// entry's top level).
function inlineDiffToolCall(diffs: Array<{newText: string; oldText: string; path: string}>): unknown {
  return {
    content: diffs.map(d => ({...d, type: 'diff'})),
    kind: 'edit',
    locations: diffs.map(d => ({path: d.path})),
    status: 'pending',
    title: `Edit ${diffs[0]!.path}`,
    toolCallId: 'call-1',
  }
}

// Helper: nested `.diff` shape some drivers emit.
function nestedDiffToolCall(diffs: Array<{newText: string; oldText: string; path: string}>): unknown {
  return {
    content: diffs.map(d => ({diff: d, type: 'diff'})),
    kind: 'edit',
    toolCallId: 'call-1',
  }
}

describe('decideAutoApprovalForEditAsWrite (B2)', () => {
  describe('approves', () => {
    it('inline diff with empty oldText + non-empty newText within projectRoot', () => {
      const tc = inlineDiffToolCall([{newText: 'console.log("hi")\n', oldText: '', path: `${PROJECT_ROOT}/src/main.js`}])
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce, rejectOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result?.optionId).to.equal('approved')
      expect(result?.reason).to.match(/empty-oldText Edit/i)
    })

    it('nested .diff shape with empty oldText', () => {
      const tc = nestedDiffToolCall([{newText: 'x', oldText: '', path: `${PROJECT_ROOT}/x.js`}])
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result?.optionId).to.equal('approved')
    })

    it('multi-file edit where every diff has empty oldText', () => {
      const tc = inlineDiffToolCall([
        {newText: 'a', oldText: '', path: `${PROJECT_ROOT}/a.js`},
        {newText: 'b', oldText: '', path: `${PROJECT_ROOT}/sub/b.js`},
      ])
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce, rejectOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result?.optionId).to.equal('approved')
    })

    it('prefers allow_always when only that flavour is offered', () => {
      const tc = inlineDiffToolCall([{newText: 'x', oldText: '', path: `${PROJECT_ROOT}/x.js`}])
      const allowAlways: PermissionOption = {kind: 'allow_always', name: 'Always', optionId: 'always-yes'}
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowAlways, rejectOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result?.optionId).to.equal('always-yes')
    })
  })

  describe('declines', () => {
    it('toolCall.kind !== "edit"', () => {
      const tc = {...inlineDiffToolCall([{newText: 'x', oldText: '', path: `${PROJECT_ROOT}/x.js`}]) as object, kind: 'write'}
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result).to.equal(undefined)
    })

    it('toolCall is not an object', () => {
      for (const tc of [null, undefined, 'edit', 42]) {
        expect(decideAutoApprovalForEditAsWrite({
          options: [allowOnce],
          projectRoot: PROJECT_ROOT,
          toolCall: tc,
        })).to.equal(undefined)
      }
    })

    it('any diff has non-empty oldText (partial replacement)', () => {
      const tc = inlineDiffToolCall([{newText: 'after', oldText: 'before', path: `${PROJECT_ROOT}/x.js`}])
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result).to.equal(undefined)
    })

    it('multi-file where ONE diff has non-empty oldText (all-or-nothing safety)', () => {
      const tc = inlineDiffToolCall([
        {newText: 'a', oldText: '', path: `${PROJECT_ROOT}/a.js`},
        {newText: 'b', oldText: 'old', path: `${PROJECT_ROOT}/b.js`},
      ])
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result, 'partial replacement in ANY file disqualifies the whole request').to.equal(undefined)
    })

    it('target path is OUTSIDE projectRoot', () => {
      const tc = inlineDiffToolCall([{newText: 'x', oldText: '', path: '/etc/passwd'}])
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result).to.equal(undefined)
    })

    it('target path uses .. to escape projectRoot', () => {
      const tc = inlineDiffToolCall([{newText: 'x', oldText: '', path: `${PROJECT_ROOT}/../outside.js`}])
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result).to.equal(undefined)
    })

    it('newText is empty (no-op or pure deletion)', () => {
      const tc = inlineDiffToolCall([{newText: '', oldText: '', path: `${PROJECT_ROOT}/x.js`}])
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result).to.equal(undefined)
    })

    it('options offer NO allow flavour (only reject_once / reject_always)', () => {
      const tc = inlineDiffToolCall([{newText: 'x', oldText: '', path: `${PROJECT_ROOT}/x.js`}])
      const result = decideAutoApprovalForEditAsWrite({
        options: [rejectOnce, {kind: 'reject_always', name: 'Never', optionId: 'never'}],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result).to.equal(undefined)
    })

    it('no content entries at all', () => {
      const tc = {content: [], kind: 'edit'}
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result).to.equal(undefined)
    })

    it('content entries are non-diff (e.g. text-only)', () => {
      const tc = {content: ['some text'], kind: 'edit'}
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result).to.equal(undefined)
    })

    it('diff path is missing', () => {
      const tc = {content: [{newText: 'x', oldText: '', type: 'diff'}], kind: 'edit'}
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result).to.equal(undefined)
    })
  })

  describe('V6 verbatim scenario', () => {
    it('reproduces the codex run-2/run-3 §3b request — full-file rewrite of own engine.js', () => {
      // From EVALUATION.md run-3 §3b: codex emits Edit with oldText: ""
      // and the full 4892-byte file as newText.
      const enginePath = `${PROJECT_ROOT}/engine.js`
      const tc = {
        content: [{newText: '/* 4892 bytes of engine code */\n', oldText: '', path: enginePath, type: 'diff'}],
        kind: 'edit',
        locations: [{path: enginePath}],
        rawInput: {changes: {[enginePath]: {content: '/* ... */', type: 'add'}}},
        status: 'pending',
        title: `Edit ${enginePath}`,
        toolCallId: 'call_codex',
      }
      const result = decideAutoApprovalForEditAsWrite({
        options: [allowOnce, rejectOnce],
        projectRoot: PROJECT_ROOT,
        toolCall: tc,
      })
      expect(result?.optionId).to.equal('approved')
    })
  })
})
