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

    it('[1,0,2] absent from disk, index differs from HEAD reports both staged-modified + unstaged-deleted', () => {
      // Native git shows MD: HEAD->INDEX is a modification, INDEX->WORKDIR is a deletion.
      // Mirrors [1,0,3]; anything less leaves vc status disagreeing with vc diff --staged.
      const c = classifyTuple(1, 0, 2)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([
        {staged: true, status: 'modified'},
        {staged: false, status: 'deleted'},
      ])
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
    it('[1,1,3] workdir restored to HEAD after add reports both staged + unstaged modifications', () => {
      // When stage differs from both HEAD and workdir, native git surfaces a staged
      // modified entry AND an unstaged modified entry. Mirrors [1,2,3]; anything less
      // leaves `vc status` and `vc diff` disagreeing on the unstaged side.
      const c = classifyTuple(1, 1, 3)
      expect(c.dirty).to.equal(true)
      expect(c.staged).to.equal(true)
      expect(c.files).to.deep.equal([
        {staged: true, status: 'modified'},
        {staged: false, status: 'modified'},
      ])
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

  describe('cross-property invariants over the full (h,w,s) cartesian product', () => {
    // The algorithmic body is total over the encoding's value range. These properties
    // hold by construction for every in-range (h,w,s); if any one fails, the algorithm
    // has been broken in a way that no per-tuple test would necessarily catch.
    const inRangeTuples: Array<[number, number, number]> = []
    for (const h of [0, 1]) {
      for (const w of [0, 1, 2]) {
        for (const s of [0, 1, 2, 3]) {
          inRangeTuples.push([h, w, s])
        }
      }
    }

    for (const [head, workdir, stage] of inRangeTuples) {
      const tag = `[${head},${workdir},${stage}]`

      it(`${tag} dirty <-> !(h===1 && w===1 && s===1)`, () => {
        const c = classifyTuple(head, workdir, stage)
        expect(c.dirty).to.equal(!(head === 1 && workdir === 1 && stage === 1))
      })

      it(`${tag} staged <-> stagedDiff defined`, () => {
        const c = classifyTuple(head, workdir, stage)
        expect(c.staged).to.equal(c.stagedDiff !== undefined)
      })

      it(`${tag} staged <-> (stage !== head)`, () => {
        const c = classifyTuple(head, workdir, stage)
        expect(c.staged).to.equal(stage !== head)
      })

      it(`${tag} untracked entry present <-> s===0 && w>0`, () => {
        const c = classifyTuple(head, workdir, stage)
        const hasUntracked = c.files.some((f) => f.status === 'untracked')
        expect(hasUntracked).to.equal(stage === 0 && workdir > 0)
      })

      it(`${tag} files.length matches stagedDiff/untracked/unstagedDiff projections`, () => {
        const c = classifyTuple(head, workdir, stage)
        const untracked = stage === 0 && workdir > 0
        const expectedLen = (c.stagedDiff ? 1 : 0) + (untracked ? 1 : c.unstagedDiff ? 1 : 0)
        expect(c.files.length).to.equal(expectedLen)
      })

      it(`${tag} when files reports any entry, dirty must be true`, () => {
        const c = classifyTuple(head, workdir, stage)
        if (c.files.length > 0) expect(c.dirty).to.equal(true)
      })
    }
  })

  describe('out-of-range columns', () => {
    // The algorithm is total over the encoding's value range. Columns outside that
    // range are the cleanest signal that isomorphic-git changed the encoding shape.
    it('throws GitError when HEAD column is out of range', () => {
      expect(() => classifyTuple(2, 0, 0)).to.throw(GitError, /HEAD column out of range/)
    })

    it('throws GitError when WORKDIR column is out of range', () => {
      expect(() => classifyTuple(0, 3, 0)).to.throw(GitError, /WORKDIR column out of range/)
    })

    it('throws GitError when STAGE column is out of range', () => {
      expect(() => classifyTuple(0, 0, 4)).to.throw(GitError, /STAGE column out of range/)
    })
  })
})
