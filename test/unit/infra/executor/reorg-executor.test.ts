/* eslint-disable @typescript-eslint/no-explicit-any */
import {expect} from 'chai'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import sinon from 'sinon'

import type {ReorgCandidate} from '../../../../src/server/core/interfaces/executor/i-reorg-executor.js'

import {generateFrontmatter} from '../../../../src/server/core/domain/knowledge/markdown-writer.js'
import {ReorgExecutor} from '../../../../src/server/infra/executor/reorg-executor.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCandidate(type: 'merge' | 'move'): ReorgCandidate {
  return {
    confidence: 0.9,
    detectionMetadata: {},
    reason: `test ${type}`,
    sourcePaths: ['domain/topic/source.md'],
    targetPath: 'domain/topic/target.md',
    type,
  }
}

function writeEntry(dir: string, relativePath: string, opts?: {
  body?: string
  title?: string
}): void {
  const fullPath = join(dir, relativePath)
  const parentDir = fullPath.replace(/\/[^/]+$/, '')
  mkdirSync(parentDir, {recursive: true})

  const fm = generateFrontmatter(
    opts?.title ?? 'Entry',
    [],
    ['test'],
    ['test'],
    {importance: 50, maturity: 'draft'},
  )
  writeFileSync(fullPath, `${fm}\n${opts?.body ?? 'Content.'}`, 'utf8')
}

function makeMockHarnessService(
  candidates: ReorgCandidate[],
  validated: ReorgCandidate[],
): any {
  return {
    detectAndValidate: sinon.stub().resolves({
      candidates,
      selection: candidates.length > 0 ? {mode: 'fast', node: {id: 'node-1'}} : null,
      validated,
    }),
    recordFeedback: sinon.stub().resolves(),
    refineIfNeeded: sinon.stub().resolves(),
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ReorgExecutor', () => {
  let testDir: string
  let contextTreeDir: string
  let projectBaseDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'brv-test-'))
    contextTreeDir = join(testDir, 'context-tree')
    projectBaseDir = testDir
    mkdirSync(contextTreeDir, {recursive: true})
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  it('dryRun returns candidates without executing', async () => {
    const candidate = makeCandidate('merge')
    const harnessService = makeMockHarnessService([candidate], [candidate])
    const executor = new ReorgExecutor({harnessService})

    const summary = await executor.detectAndExecute({
      agent: {} as any,
      contextTreeDir,
      dryRun: true,
      projectBaseDir,
    })

    expect(summary.candidatesDetected).to.equal(1)
    expect(summary.candidatesExecuted).to.equal(0)
    expect(summary.results).to.have.lengthOf(0)
    // candidatesSkipped = detected - validated (rejected by safety validator)
    // In this test: 1 detected, 1 validated → 0 skipped
    expect(summary.candidatesSkipped).to.equal(0)
  })

  it('successful execution: begin, execute, commit, maintenance, feedback', async () => {
    // Set up real files for the merge operation
    writeEntry(contextTreeDir, 'domain/topic/source.md', {
      body: 'Source body.',
      title: 'Source',
    })
    writeEntry(contextTreeDir, 'domain/topic/target.md', {
      body: 'Target body.',
      title: 'Target',
    })

    const candidate = makeCandidate('merge')
    const harnessService = makeMockHarnessService([candidate], [candidate])
    const executor = new ReorgExecutor({harnessService})

    const summary = await executor.detectAndExecute({
      agent: {} as any,
      contextTreeDir,
      dryRun: false,
      projectBaseDir,
    })

    expect(summary.candidatesExecuted).to.equal(1)
    expect(summary.results).to.have.lengthOf(1)
    expect(summary.results[0].success).to.be.true

    // Feedback should have been recorded
    expect(harnessService.recordFeedback.calledOnce).to.be.true
    expect(harnessService.refineIfNeeded.calledOnce).to.be.true
  })

  it('failed execution: begin, execute, rollback, throw', async () => {
    // Set up source file but deliberately DON'T create target, so merge fails
    // Actually the ReorgOperationExecutor catches errors and returns {success: false}
    // So we need source to exist but target to not exist for readFile to fail
    writeEntry(contextTreeDir, 'domain/topic/source.md', {title: 'Source'})
    // target does NOT exist -> executeMerge will fail reading target

    const candidate = makeCandidate('merge')
    const harnessService = makeMockHarnessService([candidate], [candidate])
    const executor = new ReorgExecutor({harnessService})

    try {
      await executor.detectAndExecute({
        agent: {} as any,
        contextTreeDir,
        dryRun: false,
        projectBaseDir,
      })
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect((error as Error).message).to.include('rolled back')
    }

    // After rollback, the original source file should still exist
    const {existsSync} = await import('node:fs')
    expect(existsSync(join(contextTreeDir, 'domain/topic/source.md'))).to.be.true
  })

  it('empty candidates: no transaction started', async () => {
    const harnessService = makeMockHarnessService([], [])
    const executor = new ReorgExecutor({harnessService})

    const summary = await executor.detectAndExecute({
      agent: {} as any,
      contextTreeDir,
      dryRun: false,
      projectBaseDir,
    })

    expect(summary.candidatesDetected).to.equal(0)
    expect(summary.candidatesExecuted).to.equal(0)
    expect(summary.results).to.have.lengthOf(0)
    // No transaction means no backup dir should exist
    const {existsSync} = await import('node:fs')
    expect(existsSync(`${contextTreeDir}-reorg-backup`)).to.be.false
  })
})
