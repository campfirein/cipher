import {expectTypeOf} from 'expect-type'

import type {
  GitBranch,
  GitCommit,
  GitConflict,
  GitStatus,
  GitStatusFile,
  MergeResult,
  PullResult,
  PushResult,
} from '../../../../../src/server/core/interfaces/services/i-git-service.js'

describe('IGitService types', () => {
  describe('GitStatusFile', () => {
    it('status is a string literal union including untracked', () => {
      expectTypeOf<GitStatusFile['status']>().toEqualTypeOf<'added' | 'deleted' | 'modified' | 'untracked'>()
    })

    it('staged is a boolean', () => {
      expectTypeOf<GitStatusFile['staged']>().toEqualTypeOf<boolean>()
    })
  })

  describe('PushResult', () => {
    it('success true variant has no reason field', () => {
      const result: PushResult = {success: true}
      if (result.success) {
        expectTypeOf(result).toEqualTypeOf<{success: true}>()
      }
    })

    it('success false variant narrows to non_fast_forward reason', () => {
      const result: PushResult = {reason: 'non_fast_forward', success: false}
      if (!result.success) {
        expectTypeOf(result.reason).toEqualTypeOf<'non_fast_forward'>()
        expectTypeOf(result.message).toEqualTypeOf<string | undefined>()
      }
    })
  })

  describe('PullResult', () => {
    it('success false variant narrows to conflicts array', () => {
      const conflict: GitConflict = {path: 'foo.md', type: 'both_modified'}
      const result: PullResult = {conflicts: [conflict], success: false}
      if (!result.success) {
        expectTypeOf(result.conflicts).toEqualTypeOf<GitConflict[]>()
      }
    })
  })

  describe('MergeResult', () => {
    it('success false variant narrows to conflicts array', () => {
      const result: MergeResult = {conflicts: [], success: false}
      if (!result.success) {
        expectTypeOf(result.conflicts).toEqualTypeOf<GitConflict[]>()
      }
    })
  })

  describe('GitConflict', () => {
    it('has path string', () => {
      expectTypeOf<GitConflict['path']>().toEqualTypeOf<string>()
    })
  })

  describe('GitStatus', () => {
    it('has files array and isClean boolean', () => {
      expectTypeOf<GitStatus['files']>().toEqualTypeOf<GitStatusFile[]>()
      expectTypeOf<GitStatus['isClean']>().toEqualTypeOf<boolean>()
    })
  })

  describe('GitCommit', () => {
    it('has expected shape', () => {
      expectTypeOf<GitCommit['sha']>().toEqualTypeOf<string>()
      expectTypeOf<GitCommit['timestamp']>().toEqualTypeOf<Date>()
      expectTypeOf<GitCommit['author']>().toEqualTypeOf<{email: string; name: string}>()
    })
  })

  describe('GitBranch', () => {
    it('has name and isCurrent', () => {
      expectTypeOf<GitBranch['name']>().toEqualTypeOf<string>()
      expectTypeOf<GitBranch['isCurrent']>().toEqualTypeOf<boolean>()
    })
  })
})
