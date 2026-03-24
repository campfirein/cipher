import {expect} from 'chai'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ReorgCandidate} from '../../../../../src/server/core/interfaces/executor/i-reorg-executor.js'

import {validateCandidates} from '../../../../../src/server/infra/harness/reorg/reorg-safety-validator.js'

function makeCandidate(overrides: Partial<ReorgCandidate> = {}): ReorgCandidate {
  return {
    confidence: 0.8,
    detectionMetadata: {},
    reason: 'test',
    sourcePaths: ['domain/topic/source.md'],
    targetPath: 'domain/topic/target.md',
    type: 'merge',
    ...overrides,
  }
}

describe('reorg-safety-validator', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'brv-validate-'))
    mkdirSync(join(testDir, 'domain', 'topic'), {recursive: true})
  })

  afterEach(() => { rmSync(testDir, {force: true, recursive: true}) })

  it('merge: rejects when target does not exist', async () => {
    writeFileSync(join(testDir, 'domain', 'topic', 'source.md'), '---\ntitle: Source\nkeywords: []\ntags: []\nrelated: []\n---\n# Source')
    const result = await validateCandidates([makeCandidate()], testDir)
    expect(result.rejected).to.have.length(1)
    expect(result.rejected[0].reason).to.include('target')
  })

  it('merge: approves when both source and target exist', async () => {
    writeFileSync(join(testDir, 'domain', 'topic', 'source.md'), '---\ntitle: Source\nkeywords: []\ntags: []\nrelated: []\n---\n# Source')
    writeFileSync(join(testDir, 'domain', 'topic', 'target.md'), '---\ntitle: Target\nkeywords: []\ntags: []\nrelated: []\n---\n# Target')
    const result = await validateCandidates([makeCandidate()], testDir)
    expect(result.approved).to.have.length(1)
  })

  it('move: rejects when target already exists', async () => {
    writeFileSync(join(testDir, 'domain', 'topic', 'source.md'), '# Source')
    writeFileSync(join(testDir, 'domain', 'topic', 'target.md'), '# Target')
    const candidate = makeCandidate({type: 'move'})
    const result = await validateCandidates([candidate], testDir)
    expect(result.rejected).to.have.length(1)
    expect(result.rejected[0].reason).to.include('exist')
  })

  it('merge: rejects when target has core maturity and protectCore is true', async () => {
    writeFileSync(join(testDir, 'domain', 'topic', 'source.md'), '---\ntitle: Source\nkeywords: []\ntags: []\nrelated: []\nimportance: 30\nmaturity: draft\n---\n# Source')
    writeFileSync(join(testDir, 'domain', 'topic', 'target.md'), '---\ntitle: Target\nkeywords: []\ntags: []\nrelated: []\nimportance: 90\nmaturity: core\n---\n# Target')
    const result = await validateCandidates([makeCandidate()], testDir, {protectCore: true})
    expect(result.rejected).to.have.length(1)
    expect(result.rejected[0].reason).to.include('core')
  })

  it('merge: allows core target when protectCore is false', async () => {
    writeFileSync(join(testDir, 'domain', 'topic', 'source.md'), '---\ntitle: Source\nkeywords: []\ntags: []\nrelated: []\n---\n# Source')
    writeFileSync(join(testDir, 'domain', 'topic', 'target.md'), '---\ntitle: Target\nkeywords: []\ntags: []\nrelated: []\nimportance: 90\nmaturity: core\n---\n# Target')
    const result = await validateCandidates([makeCandidate()], testDir, {protectCore: false})
    expect(result.approved).to.have.length(1)
  })

  it('enforces max batch size', async () => {
    const candidates = Array.from({length: 15}, (_, i) => makeCandidate({
      sourcePaths: [`domain/topic/s${i}.md`],
      targetPath: `domain/topic/t${i}.md`,
    }))
    // Create all files
    for (const c of candidates) {
      writeFileSync(join(testDir, ...c.sourcePaths[0].split('/')), '# S')
      writeFileSync(join(testDir, ...c.targetPath.split('/')), '# T')
    }

    const result = await validateCandidates(candidates, testDir, {maxBatchSize: 5})
    expect(result.approved.length).to.be.at.most(5)
  })
})
