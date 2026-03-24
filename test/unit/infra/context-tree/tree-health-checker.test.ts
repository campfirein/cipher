import {expect} from 'chai'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  checkTreeHealth,
  LOW_IMPORTANCE_RATIO_THRESHOLD,
  MAX_ENTRIES_PER_DOMAIN,
  MIN_ENTRIES_FOR_CHECK,
  resetCooldown,
} from '../../../../src/server/infra/context-tree/tree-health-checker.js'

function writeEntry(dir: string, relativePath: string, importance = 50): void {
  const fullPath = join(dir, '.brv', 'context-tree', relativePath)
  mkdirSync(join(fullPath, '..'), {recursive: true})
  writeFileSync(fullPath, `---\ntitle: Test\nkeywords: []\ntags: []\nimportance: ${importance}\nmaturity: draft\n---\n# Body`)
}

function writeSummary(dir: string, relativePath: string): void {
  const fullPath = join(dir, '.brv', 'context-tree', relativePath)
  mkdirSync(join(fullPath, '..'), {recursive: true})
  writeFileSync(fullPath, '---\ncondensation_order: 0\ntoken_count: 100\n---\n# Summary')
}

describe('tree-health-checker', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'brv-health-'))
    mkdirSync(join(testDir, '.brv', 'context-tree'), {recursive: true})
    resetCooldown()
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  it('should return null when cooldown has not elapsed', async () => {
    for (let i = 0; i < 15; i++) {
      writeEntry(testDir, `domain/topic/entry${i}.md`, 60)
    }

    const first = await checkTreeHealth(testDir, 60_000)
    expect(first).to.not.be.null

    const second = await checkTreeHealth(testDir, 60_000)
    expect(second).to.be.null
  })

  it('should use per-project cooldown', async () => {
    const testDir2 = mkdtempSync(join(tmpdir(), 'brv-health2-'))
    mkdirSync(join(testDir2, '.brv', 'context-tree'), {recursive: true})

    for (let i = 0; i < 15; i++) {
      writeEntry(testDir, `domain/topic/entry${i}.md`, 60)
      writeEntry(testDir2, `domain/topic/entry${i}.md`, 60)
    }

    const first = await checkTreeHealth(testDir, 60_000)
    expect(first).to.not.be.null

    // Different project should NOT be blocked by first project's cooldown
    const second = await checkTreeHealth(testDir2, 60_000)
    expect(second).to.not.be.null

    rmSync(testDir2, {force: true, recursive: true})
  })

  it('should not consume cooldown for small trees', async () => {
    for (let i = 0; i < MIN_ENTRIES_FOR_CHECK - 1; i++) {
      writeEntry(testDir, `domain/topic/entry${i}.md`, 60)
    }

    const report = await checkTreeHealth(testDir, 0)
    expect(report).to.not.be.null
    expect(report!.issues).to.have.length(0)
    expect(report!.entryCount).to.equal(MIN_ENTRIES_FOR_CHECK - 1)

    // Add more entries — should still check (cooldown not consumed)
    for (let i = 0; i < 6; i++) {
      writeEntry(testDir, `domain/topic/extra${i}.md`, 60)
    }

    const report2 = await checkTreeHealth(testDir, 60_000)
    expect(report2).to.not.be.null
    expect(report2!.entryCount).to.be.greaterThan(MIN_ENTRIES_FOR_CHECK - 1)
  })

  it('should skip _index.md and derived artifacts', async () => {
    for (let i = 0; i < 5; i++) {
      writeEntry(testDir, `domain/topic/entry${i}.md`, 60)
    }

    writeSummary(testDir, 'domain/_index.md')
    writeSummary(testDir, 'domain/topic/_index.md')

    const report = await checkTreeHealth(testDir, 0)
    expect(report).to.not.be.null
    // Only 5 context entries, not 7 (summaries excluded)
    expect(report!.entryCount).to.equal(5)
  })

  it('should exclude archive stubs from entry counts', async () => {
    for (let i = 0; i < 5; i++) {
      writeEntry(testDir, `domain/topic/entry${i}.md`, 60)
    }

    // Add archive stubs — these should NOT be counted
    const stubDir = join(testDir, '.brv', 'context-tree', '_archived', 'domain', 'topic')
    mkdirSync(stubDir, {recursive: true})
    writeFileSync(join(stubDir, 'old_entry.stub.md'), '---\ntype: archive_stub\noriginal_path: domain/topic/old_entry.md\n---\n# Ghost cue')
    writeFileSync(join(stubDir, 'old_entry.full.md'), '# Full archived content')

    const report = await checkTreeHealth(testDir, 0)
    expect(report).to.not.be.null
    // Only 5 live entries, not 7 (stubs excluded)
    expect(report!.entryCount).to.equal(5)
  })

  it('should detect oversized domains', async () => {
    for (let i = 0; i < MAX_ENTRIES_PER_DOMAIN + 5; i++) {
      writeEntry(testDir, `bigdomain/topic/entry${i}.md`, 60)
    }

    const report = await checkTreeHealth(testDir, 0)
    expect(report).to.not.be.null
    const oversized = report!.issues.filter((i) => i.type === 'oversized_domain')
    expect(oversized).to.have.length(1)
    expect(oversized[0].domain).to.equal('bigdomain')
    expect(oversized[0].severity).to.equal('warning')
  })

  it('should detect domain imbalance', async () => {
    // Large domain: 30 entries
    for (let i = 0; i < 30; i++) {
      writeEntry(testDir, `large/topic/entry${i}.md`, 60)
    }

    // Small domain: 3 entries (ratio = 10x)
    for (let i = 0; i < 3; i++) {
      writeEntry(testDir, `small/topic/entry${i}.md`, 60)
    }

    const report = await checkTreeHealth(testDir, 0)
    expect(report).to.not.be.null
    const imbalance = report!.issues.filter((i) => i.type === 'domain_imbalance')
    expect(imbalance).to.have.length(1)
    expect(imbalance[0].metric).to.equal(10)
  })

  it('should detect high low-importance ratio', async () => {
    const total = 20
    const lowCount = Math.ceil(total * (LOW_IMPORTANCE_RATIO_THRESHOLD + 0.1))
    const highCount = total - lowCount

    for (let i = 0; i < lowCount; i++) {
      writeEntry(testDir, `domain/topic/low${i}.md`, 20)
    }

    for (let i = 0; i < highCount; i++) {
      writeEntry(testDir, `domain/topic/high${i}.md`, 70)
    }

    const report = await checkTreeHealth(testDir, 0)
    expect(report).to.not.be.null
    const lowImportance = report!.issues.filter((i) => i.type === 'low_importance_ratio')
    expect(lowImportance).to.have.length(1)
    expect(lowImportance[0].severity).to.equal('warning')
  })

  it('should report no issues for a healthy tree', async () => {
    for (let i = 0; i < 8; i++) {
      writeEntry(testDir, `domainA/topic/entry${i}.md`, 60)
    }

    for (let i = 0; i < 6; i++) {
      writeEntry(testDir, `domainB/topic/entry${i}.md`, 70)
    }

    const report = await checkTreeHealth(testDir, 0)
    expect(report).to.not.be.null
    expect(report!.issues).to.have.length(0)
  })
})
