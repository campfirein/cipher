import {expect} from 'chai'

import {GitError} from '../../../../src/server/core/domain/errors/git-error.js'
import {classifyTuple} from '../../../../src/server/infra/git/status-row-classifier.js'

describe('classifyTuple', () => {
  describe('clean state', () => {
    it('[1,1,1] returns dirty=false, no entries', () => {
      const c = classifyTuple(1, 1, 1)
      expect(c.dirty).to.equal(false)
      expect(c.staged).to.equal(false)
      expect(c.files).to.deep.equal([])
      expect(c.stagedDiff).to.equal(undefined)
      expect(c.unstagedDiff).to.equal(undefined)
    })
  })

  describe('untracked / new file', () => {
    it('[0,2,0] untracked new file', () => {
      const c = classifyTuple(0, 2, 0)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(false)
      expect(c.files).to.deep.equal([{staged: false, status: 'untracked'}])
      expect(c.stagedDiff).to.equal(undefined)
      expect(c.unstagedDiff).to.equal(undefined)
    })

    it('[0,2,2] staged new file', () => {
      const c = classifyTuple(0, 2, 2)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([{staged: true, status: 'added'}])
      expect(c.stagedDiff).to.equal('added')
      expect(c.unstagedDiff).to.equal(undefined)
    })

    it('[0,2,3] partially staged new file', () => {
      const c = classifyTuple(0, 2, 3)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([
        {staged: true, status: 'added'},
        {staged: false, status: 'modified'},
      ])
      expect(c.stagedDiff).to.equal('added')
      expect(c.unstagedDiff).to.equal('modified')
    })
  })

  describe('deletions', () => {
    it('[1,0,0] staged deletion (git rm)', () => {
      const c = classifyTuple(1, 0, 0)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([{staged: true, status: 'deleted'}])
      expect(c.stagedDiff).to.equal('deleted')
      expect(c.unstagedDiff).to.equal(undefined)
    })

    it('[1,0,1] unstaged deletion (rm without git rm)', () => {
      const c = classifyTuple(1, 0, 1)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(false)
      expect(c.files).to.deep.equal([{staged: false, status: 'deleted'}])
      expect(c.stagedDiff).to.equal(undefined)
      expect(c.unstagedDiff).to.equal('deleted')
    })

    it('[1,0,2] absent from disk, index differs from HEAD', () => {
      const c = classifyTuple(1, 0, 2)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([{staged: false, status: 'deleted'}])
      expect(c.stagedDiff).to.equal('modified')
      expect(c.unstagedDiff).to.equal('deleted')
    })

    it('[1,0,3] staged modification then deleted from disk', () => {
      const c = classifyTuple(1, 0, 3)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([
        {staged: true, status: 'modified'},
        {staged: false, status: 'deleted'},
      ])
      expect(c.stagedDiff).to.equal('modified')
      expect(c.unstagedDiff).to.equal('deleted')
    })

    it('[1,1,0] git rm --cached', () => {
      const c = classifyTuple(1, 1, 0)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([
        {staged: true, status: 'deleted'},
        {staged: false, status: 'untracked'},
      ])
      expect(c.stagedDiff).to.equal('deleted')
      expect(c.unstagedDiff).to.equal(undefined)
    })

    it('[1,2,0] git rm --cached then edit workdir', () => {
      const c = classifyTuple(1, 2, 0)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([
        {staged: true, status: 'deleted'},
        {staged: false, status: 'untracked'},
      ])
      expect(c.stagedDiff).to.equal('deleted')
      expect(c.unstagedDiff).to.equal(undefined)
    })

    it('[0,0,3] staged add then deleted from disk', () => {
      const c = classifyTuple(0, 0, 3)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([
        {staged: true, status: 'added'},
        {staged: false, status: 'deleted'},
      ])
      expect(c.stagedDiff).to.equal('added')
      expect(c.unstagedDiff).to.equal('deleted')
    })
  })

  describe('modifications', () => {
    it('[1,1,3] workdir restored to HEAD after add', () => {
      const c = classifyTuple(1, 1, 3)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([{staged: true, status: 'modified'}])
      expect(c.stagedDiff).to.equal('modified')
      expect(c.unstagedDiff).to.equal('modified')
    })

    it('[1,2,1] unstaged modification', () => {
      const c = classifyTuple(1, 2, 1)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(false)
      expect(c.files).to.deep.equal([{staged: false, status: 'modified'}])
      expect(c.stagedDiff).to.equal(undefined)
      expect(c.unstagedDiff).to.equal('modified')
    })

    it('[1,2,2] staged modification', () => {
      const c = classifyTuple(1, 2, 2)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([{staged: true, status: 'modified'}])
      expect(c.stagedDiff).to.equal('modified')
      expect(c.unstagedDiff).to.equal(undefined)
    })

    it('[1,2,3] partially staged modification', () => {
      const c = classifyTuple(1, 2, 3)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([
        {staged: true, status: 'modified'},
        {staged: false, status: 'modified'},
      ])
      expect(c.stagedDiff).to.equal('modified')
      expect(c.unstagedDiff).to.equal('modified')
    })
  })

  describe('cross-property invariants over all known tuples', () => {
    const knownTuples: Array<[number, number, number]> = [
      [0, 0, 3],
      [0, 2, 0],
      [0, 2, 2],
      [0, 2, 3],
      [1, 0, 0],
      [1, 0, 1],
      [1, 0, 2],
      [1, 0, 3],
      [1, 1, 0],
      [1, 1, 1],
      [1, 1, 3],
      [1, 2, 0],
      [1, 2, 1],
      [1, 2, 2],
      [1, 2, 3],
    ]

    for (const [head, workdir, stage] of knownTuples) {
      const tag = `[${head},${workdir},${stage}]`

      it(`${tag} dirty matches pull's filter (workdir!==1 || stage!==1)`, () => {
        const c = classifyTuple(head, workdir, stage)
        const pullDirty = workdir !== 1 || stage !== 1
        expect(c.dirty).to.equal(pullDirty)
      })

      it(`${tag} staged matches stage!==head`, () => {
        const c = classifyTuple(head, workdir, stage)
        expect(c.staged).to.equal(stage !== head)
      })

      it(`${tag} when status reports any file, dirty must be true`, () => {
        const c = classifyTuple(head, workdir, stage)
        if (c.files.length > 0) expect(c.dirty).to.equal(true)
      })

      it(`${tag} stagedDiff present iff staged is true (or untracked)`, () => {
        const c = classifyTuple(head, workdir, stage)
        // [0,2,0] is the one case where staged=false but caller may still want to skip stagedDiff
        if (c.stagedDiff !== undefined) expect(c.staged).to.equal(true)
      })
    }
  })

  describe('unknown tuples', () => {
    it('throws GitError on a shape not in the reachable set', () => {
      expect(() => classifyTuple(0, 0, 1)).to.throw(GitError, /Unknown statusMatrix tuple/)
    })

    it('throws GitError on [1,1,2] (theoretically impossible per isomorphic-git encoding)', () => {
      expect(() => classifyTuple(1, 1, 2)).to.throw(GitError)
    })
  })
})
