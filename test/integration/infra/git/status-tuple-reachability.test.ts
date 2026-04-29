/**
 * Tuple reachability harness for `git.statusMatrix`.
 *
 * Drives statusMatrix through a corpus of operation sequences that cover every
 * git-state transition we can think of, then asserts that every tuple it
 * produces is classifiable by `classifyTuple` (i.e. doesn't throw).
 *
 * The bug class this guards against is a silent-drop: a reachable tuple
 * exists in the wild but no consumer enumerates it. Throw-on-unknown in the
 * unified classifier converts that silent-drop into a loud failure, but only
 * if the test corpus actually exercises the tuple. This harness IS that corpus.
 *
 * If a scenario surfaces a new tuple, classifyTuple throws and this test
 * fails. The fix is then to add the tuple to the classifier with the right
 * projection, and to add the scenario as a permanent regression case.
 */
import {expect} from 'chai'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import {mkdir, rm, unlink, utimes, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {classifyTuple} from '../../../../src/server/infra/git/status-row-classifier.js'

const author = {email: 't@t.com', name: 'T'}

function makeDir(): string {
  return join(tmpdir(), `tuple-fuzz-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
}

async function initWithFile(dir: string, file: string, content: string): Promise<string> {
  await mkdir(dir, {recursive: true})
  await git.init({defaultBranch: 'main', dir, fs})
  await writeFile(join(dir, file), content)
  await git.add({dir, filepath: file, fs})
  return git.commit({author, dir, fs, message: 'init'})
}

type Scenario = {
  /**
   * When set, the scenario is expected to produce exactly this tuple at this filepath.
   * Locks the scenario name to the actual matrix row so a quietly-shifted recipe
   * (e.g. isomorphic-git encoding change) fails loudly instead of silently classifying
   * a different tuple under the named scenario.
   */
  expectedTuple?: {filepath: string; tuple: [number, number, number]}
  name: string
  setup: (dir: string) => Promise<void>
}

const scenarios: Scenario[] = [
  {
    name: 'empty repo',
    async setup(dir) {
      await mkdir(dir, {recursive: true})
      await git.init({defaultBranch: 'main', dir, fs})
    },
  },
  {
    name: 'baseline single committed file (clean)',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
    },
  },
  {
    expectedTuple: {filepath: 'new.md', tuple: [0, 2, 0]},
    name: '[0,2,0] untracked new file',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'new.md'), 'fresh')
    },
  },
  {
    expectedTuple: {filepath: 'new.md', tuple: [0, 2, 2]},
    name: '[0,2,2] staged new file',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'new.md'), 'fresh')
      await git.add({dir, filepath: 'new.md', fs})
    },
  },
  {
    expectedTuple: {filepath: 'new.md', tuple: [0, 2, 3]},
    name: '[0,2,3] partially staged new file',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'new.md'), 'fresh')
      await git.add({dir, filepath: 'new.md', fs})
      await writeFile(join(dir, 'new.md'), 'modified after stage')
    },
  },
  {
    expectedTuple: {filepath: 'new.md', tuple: [0, 0, 3]},
    name: '[0,0,3] staged add then deleted from disk',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'new.md'), 'fresh')
      await git.add({dir, filepath: 'new.md', fs})
      await unlink(join(dir, 'new.md'))
    },
  },
  {
    expectedTuple: {filepath: 'f.md', tuple: [1, 0, 0]},
    name: '[1,0,0] staged deletion (git rm)',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await git.remove({dir, filepath: 'f.md', fs})
      await unlink(join(dir, 'f.md'))
    },
  },
  {
    expectedTuple: {filepath: 'f.md', tuple: [1, 0, 1]},
    name: '[1,0,1] unstaged deletion (rm without git rm)',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await unlink(join(dir, 'f.md'))
    },
  },
  // Note: [1,0,2] is unreachable by the encoding. w=0 means WORKDIR is absent;
  // s=2 means "INDEX matches WORKDIR" by content, which is impossible when WORKDIR
  // has no content. The encoding produces s=0 (INDEX absent) or s=3 (differs from both)
  // in that situation. The scenario for [1,0,3] below covers the realistic recipe.
  {
    expectedTuple: {filepath: 'f.md', tuple: [1, 0, 3]},
    name: '[1,0,3] staged modification then deleted from disk',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
      await git.add({dir, filepath: 'f.md', fs})
      await writeFile(join(dir, 'f.md'), 'v3') // make stage=3 by introducing partial-stage
      await unlink(join(dir, 'f.md'))
    },
  },
  {
    expectedTuple: {filepath: 'f.md', tuple: [1, 1, 0]},
    name: '[1,1,0] git rm --cached only',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await git.remove({dir, filepath: 'f.md', fs})
    },
  },
  {
    expectedTuple: {filepath: 'f.md', tuple: [1, 2, 0]},
    name: '[1,2,0] git rm --cached then edit workdir',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await git.remove({dir, filepath: 'f.md', fs})
      await writeFile(join(dir, 'f.md'), 'v2-after-rm-cached')
    },
  },
  {
    expectedTuple: {filepath: 'f.md', tuple: [1, 1, 3]},
    name: '[1,1,3] workdir restored to HEAD after add',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
      await git.add({dir, filepath: 'f.md', fs})
      // Filesystem-only restore to HEAD content. utimes bumps mtime past the
      // index's stat cache so isomorphic-git re-hashes the workdir blob; without
      // that, the tuple collapses to [1,2,2] and the [1,1,3] scenario silently
      // turns into a duplicate of [1,2,2].
      await writeFile(join(dir, 'f.md'), 'v1')
      const future = new Date(Date.now() + 2000)
      await utimes(join(dir, 'f.md'), future, future)
    },
  },
  {
    expectedTuple: {filepath: 'f.md', tuple: [1, 2, 1]},
    name: '[1,2,1] unstaged modification',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
      // Same-size payloads share stat info so the index cache reports clean unless
      // mtime is bumped past the cached value (same workaround as [1,1,3]).
      const future = new Date(Date.now() + 2000)
      await utimes(join(dir, 'f.md'), future, future)
    },
  },
  {
    expectedTuple: {filepath: 'f.md', tuple: [1, 2, 2]},
    name: '[1,2,2] staged modification',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
      await git.add({dir, filepath: 'f.md', fs})
    },
  },
  {
    expectedTuple: {filepath: 'f.md', tuple: [1, 2, 3]},
    name: '[1,2,3] partially staged modification',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
      await git.add({dir, filepath: 'f.md', fs})
      await writeFile(join(dir, 'f.md'), 'v3')
      // Bump mtime so the post-add v3 write is observed despite same byte size.
      const future = new Date(Date.now() + 2000)
      await utimes(join(dir, 'f.md'), future, future)
    },
  },
  {
    name: 'multi-file: staged-mod + unstaged-mod + untracked',
    async setup(dir) {
      await mkdir(dir, {recursive: true})
      await git.init({defaultBranch: 'main', dir, fs})
      await Promise.all(['a.md', 'b.md', 'c.md'].map((f) => writeFile(join(dir, f), 'v1')))
      await git.add({dir, filepath: 'a.md', fs})
      await git.add({dir, filepath: 'b.md', fs})
      await git.add({dir, filepath: 'c.md', fs})
      await git.commit({author, dir, fs, message: 'init'})
      await writeFile(join(dir, 'a.md'), 'staged-mod')
      await git.add({dir, filepath: 'a.md', fs})
      await writeFile(join(dir, 'b.md'), 'unstaged-mod')
      await writeFile(join(dir, 'untracked.md'), 'fresh')
    },
  },
  {
    name: 'merge conflict: both_modified',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'base')
      await git.branch({dir, fs, ref: 'feature'})
      await git.checkout({dir, fs, ref: 'feature'})
      await writeFile(join(dir, 'f.md'), 'feature')
      await git.add({dir, filepath: 'f.md', fs})
      await git.commit({author, dir, fs, message: 'feature edit'})
      await git.checkout({dir, fs, ref: 'main'})
      await writeFile(join(dir, 'f.md'), 'main')
      await git.add({dir, filepath: 'f.md', fs})
      await git.commit({author, dir, fs, message: 'main edit'})
      try {
        await git.merge({author, dir, fs, theirs: 'feature'})
      } catch {
        // MergeConflictError expected
      }
    },
  },
  {
    name: 'merge conflict: both_added (same path on two branches)',
    async setup(dir) {
      await initWithFile(dir, 'seed.md', 'seed')
      await git.branch({dir, fs, ref: 'feature'})
      await git.checkout({dir, fs, ref: 'feature'})
      await writeFile(join(dir, 'shared.md'), 'feature variant')
      await git.add({dir, filepath: 'shared.md', fs})
      await git.commit({author, dir, fs, message: 'feature add'})
      await git.checkout({dir, fs, ref: 'main'})
      await writeFile(join(dir, 'shared.md'), 'main variant')
      await git.add({dir, filepath: 'shared.md', fs})
      await git.commit({author, dir, fs, message: 'main add'})
      try {
        await git.merge({author, dir, fs, theirs: 'feature'})
      } catch {
        // MergeConflictError expected
      }
    },
  },
  {
    name: 'merge conflict: deleted_modified (one side deletes, other modifies)',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'base')
      await git.branch({dir, fs, ref: 'feature'})
      await git.checkout({dir, fs, ref: 'feature'})
      await writeFile(join(dir, 'f.md'), 'feature edit')
      await git.add({dir, filepath: 'f.md', fs})
      await git.commit({author, dir, fs, message: 'feature edit'})
      await git.checkout({dir, fs, ref: 'main'})
      await git.remove({dir, filepath: 'f.md', fs})
      await unlink(join(dir, 'f.md'))
      await git.commit({author, dir, fs, message: 'main delete'})
      try {
        await git.merge({author, dir, fs, theirs: 'feature'})
      } catch {
        // MergeConflictError expected
      }
    },
  },
  {
    name: 'reset --soft analog: commit then unstage via resetIndex',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
      await git.add({dir, filepath: 'f.md', fs})
      await git.commit({author, dir, fs, message: 'v2'})
      // soft reset: index keeps v2, HEAD moved back, workdir keeps v2 — should land in [1,2,2]
      const heads = await git.log({depth: 2, dir, fs})
      if (heads.length >= 2) {
        await git.writeRef({dir, force: true, fs, ref: 'refs/heads/main', value: heads[1].oid})
      }
    },
  },
  {
    name: 'nested directory tracked file modified',
    async setup(dir) {
      await mkdir(join(dir, 'sub', 'deep'), {recursive: true})
      await git.init({defaultBranch: 'main', dir, fs})
      await writeFile(join(dir, 'sub', 'deep', 'f.md'), 'v1')
      await git.add({dir, filepath: 'sub/deep/f.md', fs})
      await git.commit({author, dir, fs, message: 'init'})
      await writeFile(join(dir, 'sub', 'deep', 'f.md'), 'v2')
    },
  },
]

describe('statusMatrix tuple reachability fuzz (Gap D)', () => {
  const observedTuples = new Set<string>()
  const unclassifiableTuples: Array<{key: string; scenario: string}> = []

  for (const scenario of scenarios) {
    it(`scenario "${scenario.name}" → every observed tuple is classifiable`, async () => {
      const dir = makeDir()
      try {
        await scenario.setup(dir)
        const matrix = await git.statusMatrix({dir, fs})
        if (scenario.expectedTuple) {
          const {filepath, tuple} = scenario.expectedTuple
          const row = matrix.find((r) => r[0] === filepath)
          expect(row, `scenario "${scenario.name}" expected ${filepath} present in matrix`).to.not.be.undefined
          expect(row).to.deep.equal([filepath, ...tuple])
        }

        for (const [filepath, head, workdir, stage] of matrix) {
          const key = `[${head},${workdir},${stage}]`
          observedTuples.add(key)
          try {
            classifyTuple(head, workdir, stage)
          } catch (error) {
            unclassifiableTuples.push({key, scenario: `${scenario.name} (${String(filepath)})`})
            throw error
          }
        }
      } finally {
        await rm(dir, {force: true, recursive: true}).catch(() => {})
      }
    })
  }

  it('reachable set is non-empty and fully classifiable', () => {
    // The per-scenario tests above are the real regression guard: a new tuple
    // surfaces ⇒ classifyTuple throws ⇒ that test fails. This summary just
    // pins a sanity floor so an empty/silent harness can't pretend to pass.
    expect(unclassifiableTuples).to.deep.equal([])
    expect(observedTuples.size).to.be.greaterThan(0)
  })
})
