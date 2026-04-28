/**
 * Tuple reachability harness (Gap D verification for ENG-2516).
 *
 * Drives `git.statusMatrix` through a corpus of operation sequences that
 * cover every git-state transition I can think of, then asserts that every
 * tuple it produces is classifiable by `classifyTuple` (i.e. doesn't throw).
 *
 * The bug class behind ENG-2516 was a silent-drop: a reachable tuple existed
 * in the wild but no consumer enumerated it. Throw-on-unknown in the unified
 * classifier converts that silent-drop into a loud failure — but only if the
 * test corpus actually exercises the tuple. This harness IS that corpus.
 *
 * If a scenario surfaces a new tuple, classifyTuple throws and this test
 * fails. The fix is then to add the tuple to the classifier with the right
 * projection — and to add the scenario as a permanent regression case.
 */
import {expect} from 'chai'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import {mkdir, rm, unlink, writeFile} from 'node:fs/promises'
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
    name: '[0,2,0] untracked new file',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'new.md'), 'fresh')
    },
  },
  {
    name: '[0,2,2] staged new file',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'new.md'), 'fresh')
      await git.add({dir, filepath: 'new.md', fs})
    },
  },
  {
    name: '[0,2,3] partially staged new file',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'new.md'), 'fresh')
      await git.add({dir, filepath: 'new.md', fs})
      await writeFile(join(dir, 'new.md'), 'modified after stage')
    },
  },
  {
    name: '[0,0,3] staged add then deleted from disk',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'new.md'), 'fresh')
      await git.add({dir, filepath: 'new.md', fs})
      await unlink(join(dir, 'new.md'))
    },
  },
  {
    name: '[1,0,0] staged deletion (git rm)',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await git.remove({dir, filepath: 'f.md', fs})
      await unlink(join(dir, 'f.md'))
    },
  },
  {
    name: '[1,0,1] unstaged deletion (rm without git rm)',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await unlink(join(dir, 'f.md'))
    },
  },
  {
    name: '[1,0,2] absent from disk, index differs from HEAD',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
      await git.add({dir, filepath: 'f.md', fs})
      await unlink(join(dir, 'f.md'))
    },
  },
  {
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
    name: '[1,1,0] git rm --cached only',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await git.remove({dir, filepath: 'f.md', fs})
    },
  },
  {
    name: '[1,2,0] git rm --cached then edit workdir',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await git.remove({dir, filepath: 'f.md', fs})
      await writeFile(join(dir, 'f.md'), 'v2-after-rm-cached')
    },
  },
  {
    name: '[1,1,3] ENG-2516: workdir restored to HEAD after add',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
      await git.add({dir, filepath: 'f.md', fs})
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1100)
      })
      await writeFile(join(dir, 'f.md'), 'v1') // restore via filesystem only
    },
  },
  {
    name: '[1,2,1] unstaged modification',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
    },
  },
  {
    name: '[1,2,2] staged modification',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
      await git.add({dir, filepath: 'f.md', fs})
    },
  },
  {
    name: '[1,2,3] partially staged modification',
    async setup(dir) {
      await initWithFile(dir, 'f.md', 'v1')
      await writeFile(join(dir, 'f.md'), 'v2')
      await git.add({dir, filepath: 'f.md', fs})
      await writeFile(join(dir, 'f.md'), 'v3')
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

  it('reachable set is a subset of classifier enum (summary)', () => {
    const reachable = [...observedTuples].sort()
    // Lock the ceiling: today's harness reaches at most these tuples. If a future
    // scenario surfaces a new one, the per-scenario test above will already have
    // failed via classifyTuple's throw. This test exists to print the full set
    // for reviewers to eyeball against the classifier's enum.
    expect(unclassifiableTuples).to.deep.equal([])
    expect(reachable.length).to.be.greaterThan(0)
     
    console.log(`[tuple-fuzz] reachable tuples (${reachable.length}): ${reachable.join(' ')}`)
  })
})
