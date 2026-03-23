import {expect} from 'chai'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {generateFrontmatter} from '../../../../../src/server/core/domain/knowledge/markdown-writer.js'
import {detectCandidates} from '../../../../../src/server/infra/harness/reorg/reorg-detection-template.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function writeEntry(dir: string, relativePath: string, opts: {
  importance?: number
  keywords: string[]
  maturity?: 'core' | 'draft' | 'validated'
  title?: string
}): void {
  const fullPath = join(dir, relativePath)
  const parentDir = fullPath.replace(/\/[^/]+$/, '')
  mkdirSync(parentDir, {recursive: true})

  const fm = generateFrontmatter(
    opts.title ?? 'Entry',
    [],
    ['test'],
    opts.keywords,
    {
      importance: opts.importance ?? 50,
      maturity: opts.maturity ?? 'draft',
    },
  )
  writeFileSync(fullPath, `${fm}\nContent for ${relativePath}`, 'utf8')
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('detectCandidates', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'brv-test-'))
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  it('detects merge candidates with high keyword overlap and low importance', async () => {
    // Two entries in the same domain with overlapping keywords, one below importance threshold
    writeEntry(testDir, 'architecture/topic/entry-a.md', {
      importance: 20,
      keywords: ['react', 'hooks', 'state', 'component'],
    })
    writeEntry(testDir, 'architecture/topic/entry-b.md', {
      importance: 60,
      keywords: ['react', 'hooks', 'state', 'component'],
    })

    const candidates = await detectCandidates({
      contextTreeDir: testDir,
      templateContent: '',
    })

    const merges = candidates.filter(c => c.type === 'merge')
    expect(merges).to.have.length.greaterThanOrEqual(1)
    expect(merges[0].sourcePaths[0]).to.include('entry-a.md') // lower importance = source
    expect(merges[0].targetPath).to.include('entry-b.md') // higher importance = target
  })

  it('does not detect merge for entries with low keyword overlap', async () => {
    writeEntry(testDir, 'architecture/topic/entry-a.md', {
      importance: 20,
      keywords: ['react', 'hooks'],
    })
    writeEntry(testDir, 'architecture/topic/entry-b.md', {
      importance: 60,
      keywords: ['python', 'flask', 'api', 'server'],
    })

    const candidates = await detectCandidates({
      contextTreeDir: testDir,
      templateContent: '',
    })

    const merges = candidates.filter(c => c.type === 'merge')
    expect(merges).to.have.lengthOf(0)
  })

  it('detects move candidates when keywords match a different domain better', async () => {
    // Entry in domain "architecture" but keywords match "backend" domain better
    // architecture domain has unrelated keywords so current-domain similarity is low
    writeEntry(testDir, 'architecture/topic/misplaced.md', {
      importance: 50,
      keywords: ['database', 'postgres', 'migration', 'schema'],
    })
    writeEntry(testDir, 'architecture/topic/design-patterns.md', {
      importance: 50,
      keywords: ['singleton', 'factory', 'observer', 'strategy'],
    })

    // Entries in "backend" domain with highly overlapping keywords
    writeEntry(testDir, 'backend/topic/db-setup.md', {
      importance: 50,
      keywords: ['database', 'postgres', 'migration', 'schema'],
    })
    writeEntry(testDir, 'backend/topic/db-queries.md', {
      importance: 50,
      keywords: ['database', 'postgres', 'schema'],
    })

    const candidates = await detectCandidates({
      contextTreeDir: testDir,
      templateContent: '',
    })

    const moves = candidates.filter(c => c.type === 'move')
    expect(moves).to.have.length.greaterThanOrEqual(1)

    const misplacedMove = moves.find(c => c.sourcePaths[0].includes('misplaced.md'))
    expect(misplacedMove).to.not.be.undefined
    expect(misplacedMove!.targetPath).to.include('backend/')
  })

  it('returns no candidates for an empty tree', async () => {
    const candidates = await detectCandidates({
      contextTreeDir: testDir,
      templateContent: '',
    })

    expect(candidates).to.have.lengthOf(0)
  })

  it('handles default thresholds when template YAML is empty', async () => {
    // With default thresholds (keywordOverlap=0.7, minImportanceForKeep=35)
    // Two entries with identical keywords, one at importance 30 (below 35)
    writeEntry(testDir, 'domain/topic/a.md', {
      importance: 30,
      keywords: ['alpha', 'beta', 'gamma'],
    })
    writeEntry(testDir, 'domain/topic/b.md', {
      importance: 50,
      keywords: ['alpha', 'beta', 'gamma'],
    })

    const candidates = await detectCandidates({
      contextTreeDir: testDir,
      templateContent: '',
    })

    const merges = candidates.filter(c => c.type === 'merge')
    expect(merges).to.have.length.greaterThanOrEqual(1)
  })
})
