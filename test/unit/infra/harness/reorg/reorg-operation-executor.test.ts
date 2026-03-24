import {expect} from 'chai'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ReorgCandidate} from '../../../../../src/server/core/interfaces/executor/i-reorg-executor.js'

import {generateFrontmatter} from '../../../../../src/server/core/domain/knowledge/markdown-writer.js'
import {ReorgOperationExecutor} from '../../../../../src/server/infra/harness/reorg/reorg-operation-executor.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function writeEntry(dir: string, relativePath: string, opts?: {
  body?: string
  keywords?: string[]
  related?: string[]
  title?: string
}): void {
  const fullPath = join(dir, relativePath)
  const parentDir = fullPath.replace(/\/[^/]+$/, '')
  mkdirSync(parentDir, {recursive: true})

  const fm = generateFrontmatter(
    opts?.title ?? 'Entry',
    opts?.related ?? [],
    ['test'],
    opts?.keywords ?? ['test'],
    {importance: 50, maturity: 'draft'},
  )
  writeFileSync(fullPath, `${fm}\n${opts?.body ?? `Content for ${relativePath}`}`, 'utf8')
}

function makeMergeCandidate(source: string, target: string): ReorgCandidate {
  return {
    confidence: 0.9,
    detectionMetadata: {},
    reason: 'test merge',
    sourcePaths: [source],
    targetPath: target,
    type: 'merge',
  }
}

function makeMoveCandidate(source: string, target: string): ReorgCandidate {
  return {
    confidence: 0.8,
    detectionMetadata: {},
    reason: 'test move',
    sourcePaths: [source],
    targetPath: target,
    type: 'move',
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ReorgOperationExecutor', () => {
  let testDir: string
  let executor: ReorgOperationExecutor

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'brv-test-'))
    executor = new ReorgOperationExecutor({contextTreeDir: testDir})
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('merge', () => {
    it('target gets merged content and source is deleted', async () => {
      writeEntry(testDir, 'domain/topic/source.md', {
        body: 'Source content here.',
        keywords: ['alpha'],
        title: 'Source',
      })
      writeEntry(testDir, 'domain/topic/target.md', {
        body: 'Target content here.',
        keywords: ['beta'],
        title: 'Target',
      })

      const candidate = makeMergeCandidate('domain/topic/source.md', 'domain/topic/target.md')
      const result = await executor.execute(candidate)

      expect(result.success).to.be.true
      expect(existsSync(join(testDir, 'domain/topic/source.md'))).to.be.false
      expect(existsSync(join(testDir, 'domain/topic/target.md'))).to.be.true

      const mergedContent = readFileSync(join(testDir, 'domain/topic/target.md'), 'utf8')
      // The merged file should contain content from both source and target
      expect(mergedContent).to.include('Target')
    })

    it('rewrites relations in other files after merge', async () => {
      writeEntry(testDir, 'domain/topic/source.md', {
        body: 'Source.',
        title: 'Source',
      })
      writeEntry(testDir, 'domain/topic/target.md', {
        body: 'Target.',
        title: 'Target',
      })
      // A third file that references the source
      writeEntry(testDir, 'domain/topic/referrer.md', {
        body: 'See @domain/topic/source.md for details.',
        related: ['domain/topic/source.md'],
        title: 'Referrer',
      })

      const candidate = makeMergeCandidate('domain/topic/source.md', 'domain/topic/target.md')
      const result = await executor.execute(candidate)

      expect(result.success).to.be.true
      expect(result.changedPaths).to.include('domain/topic/target.md')

      // Check the referrer was rewritten
      const referrerContent = readFileSync(join(testDir, 'domain/topic/referrer.md'), 'utf8')
      expect(referrerContent).to.include('domain/topic/target.md')
    })

    it('returns changedPaths in result', async () => {
      writeEntry(testDir, 'domain/topic/source.md', {title: 'Source'})
      writeEntry(testDir, 'domain/topic/target.md', {title: 'Target'})

      const candidate = makeMergeCandidate('domain/topic/source.md', 'domain/topic/target.md')
      const result = await executor.execute(candidate)

      expect(result.success).to.be.true
      expect(result.changedPaths).to.include('domain/topic/target.md')
      expect(result.changedPaths).to.include('domain/topic/source.md')
    })
  })

  describe('move', () => {
    it('file moves to new directory with basename preserved', async () => {
      writeEntry(testDir, 'old-domain/topic/entry.md', {
        body: 'Content to move.',
        title: 'Moved Entry',
      })

      const candidate = makeMoveCandidate('old-domain/topic/entry.md', 'new-domain/topic/entry.md')
      const result = await executor.execute(candidate)

      expect(result.success).to.be.true
      expect(existsSync(join(testDir, 'old-domain/topic/entry.md'))).to.be.false
      expect(existsSync(join(testDir, 'new-domain/topic/entry.md'))).to.be.true

      const movedContent = readFileSync(join(testDir, 'new-domain/topic/entry.md'), 'utf8')
      expect(movedContent).to.include('Content to move.')
    })

    it('preserves original basename exactly', async () => {
      writeEntry(testDir, 'domain-a/topic/my-specific-name.md', {
        title: 'Specific Name',
      })

      const candidate = makeMoveCandidate(
        'domain-a/topic/my-specific-name.md',
        'domain-b/topic/my-specific-name.md',
      )
      const result = await executor.execute(candidate)

      expect(result.success).to.be.true
      expect(existsSync(join(testDir, 'domain-b/topic/my-specific-name.md'))).to.be.true
    })

    it('cleans empty parent directories after move', async () => {
      writeEntry(testDir, 'old-domain/empty-topic/only-file.md', {
        title: 'Only File',
      })

      const candidate = makeMoveCandidate(
        'old-domain/empty-topic/only-file.md',
        'new-domain/topic/only-file.md',
      )
      const result = await executor.execute(candidate)

      expect(result.success).to.be.true
      expect(existsSync(join(testDir, 'old-domain/empty-topic'))).to.be.false
    })

    it('returns changedPaths in result', async () => {
      writeEntry(testDir, 'domain-a/topic/file.md', {title: 'File'})

      const candidate = makeMoveCandidate('domain-a/topic/file.md', 'domain-b/topic/file.md')
      const result = await executor.execute(candidate)

      expect(result.success).to.be.true
      expect(result.changedPaths).to.include('domain-a/topic/file.md')
      expect(result.changedPaths).to.include('domain-b/topic/file.md')
    })
  })
})
