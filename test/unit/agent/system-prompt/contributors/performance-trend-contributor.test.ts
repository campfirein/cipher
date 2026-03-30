import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ContributorContext} from '../../../../../src/agent/core/domain/system-prompt/types.js'

import {PerformanceTrendContributor} from '../../../../../src/agent/infra/system-prompt/contributors/performance-trend-contributor.js'
import {
  BRV_DIR,
  CONTEXT_TREE_DIR,
  EXPERIENCE_DIR,
  EXPERIENCE_PERFORMANCE_DIR,
  EXPERIENCE_PERFORMANCE_LOG_FILE,
} from '../../../../../src/server/constants.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeContributor(options?: {entries?: Array<{domain: string; score: number}>; maxEntries?: number}): Promise<{
  baseDir: string
  contributor: PerformanceTrendContributor
}> {
  const baseDir = join(tmpdir(), `perf-trend-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const logDir = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR, EXPERIENCE_DIR, EXPERIENCE_PERFORMANCE_DIR)
  await mkdir(logDir, {recursive: true})

  if (options?.entries && options.entries.length > 0) {
    const logPath = join(logDir, EXPERIENCE_PERFORMANCE_LOG_FILE)
    const lines = options.entries.map((e, i) =>
      JSON.stringify({curationId: i, domain: e.domain, insightsActive: [], score: e.score, summary: `entry ${i}`, ts: new Date().toISOString()}),
    )
    await writeFile(logPath, lines.join('\n') + '\n', 'utf8')
  }

  const contributor = new PerformanceTrendContributor('performanceTrend', 17, {
    maxEntries: options?.maxEntries,
    workingDirectory: baseDir,
  })

  return {baseDir, contributor}
}

function curateContext(): ContributorContext {
  return {commandType: 'curate'}
}

function chatContext(): ContributorContext {
  return {commandType: 'chat'}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PerformanceTrendContributor', () => {
  it('returns empty string when no performance log exists', async () => {
    const baseDir = join(tmpdir(), `perf-trend-nolog-${Date.now()}`)
    await mkdir(baseDir, {recursive: true})
    const contributor = new PerformanceTrendContributor('performanceTrend', 17, {workingDirectory: baseDir})

    try {
      const content = await contributor.getContent(curateContext())
      expect(content).to.equal('')
    } finally {
      await rm(baseDir, {force: true, recursive: true})
    }
  })

  it('returns empty string when fewer than 3 entries', async () => {
    const {baseDir, contributor} = await makeContributor({
      entries: [
        {domain: 'test', score: 0.8},
        {domain: 'test', score: 0.9},
      ],
    })

    try {
      const content = await contributor.getContent(curateContext())
      expect(content).to.equal('')
    } finally {
      await rm(baseDir, {force: true, recursive: true})
    }
  })

  it('returns empty string for non-curate/query commands', async () => {
    const {baseDir, contributor} = await makeContributor({
      entries: [
        {domain: 'test', score: 0.8},
        {domain: 'test', score: 0.9},
        {domain: 'test', score: 0.7},
      ],
    })

    try {
      const content = await contributor.getContent(chatContext())
      expect(content).to.equal('')
    } finally {
      await rm(baseDir, {force: true, recursive: true})
    }
  })

  it('computes correct per-domain rolling averages', async () => {
    const {baseDir, contributor} = await makeContributor({
      entries: [
        {domain: 'code-review', score: 0.8},
        {domain: 'code-review', score: 0.9},
        {domain: 'valuation', score: 0.6},
        {domain: 'valuation', score: 0.7},
        {domain: 'code-review', score: 0.7},
      ],
    })

    try {
      const content = await contributor.getContent(curateContext())
      expect(content).to.include('<performance-trends>')
      expect(content).to.include('code-review')
      expect(content).to.include('valuation')
      // code-review avg: (0.8+0.9+0.7)/3 = 0.80
      expect(content).to.include('0.80')
    } finally {
      await rm(baseDir, {force: true, recursive: true})
    }
  })

  it('uses per-domain window of maxEntries, not global truncation', async () => {
    // 15 entries for domainA: scores 0.0, 0.05, 0.10, ..., 0.70
    // With maxEntries=10, only the last 10 are used (indices 5-14: 0.25..0.70)
    // avg of last 10 = (0.25+0.30+0.35+0.40+0.45+0.50+0.55+0.60+0.65+0.70)/10 = 0.475
    // avg of all 15  = (sum 0..14 * 0.05)/15 = (0+0.05+...+0.70)/15 = 5.25/15 = 0.35
    const entries: Array<{domain: string; score: number}> = []
    for (let i = 0; i < 15; i++) {
      entries.push({domain: 'domainA', score: i * 0.05})
    }

    // 3 entries for domainB — all should be included regardless of domainA's volume
    entries.push({domain: 'domainB', score: 0.5}, {domain: 'domainB', score: 0.6}, {domain: 'domainB', score: 0.7})

    const {baseDir, contributor} = await makeContributor({entries, maxEntries: 10})

    try {
      const content = await contributor.getContent(curateContext())
      // domainB must appear (per-domain window, not global truncation)
      expect(content).to.include('domainB')
      // domainA avg should be ~0.47 (last 10), NOT 0.35 (all 15)
      expect(content).to.include('0.47')
      expect(content).not.to.include('0.35')
    } finally {
      await rm(baseDir, {force: true, recursive: true})
    }
  })

  it('detects upward trend correctly', async () => {
    const {baseDir, contributor} = await makeContributor({
      entries: [
        {domain: 'test', score: 0.4},
        {domain: 'test', score: 0.5},
        {domain: 'test', score: 0.8},
        {domain: 'test', score: 0.9},
      ],
    })

    try {
      const content = await contributor.getContent(curateContext())
      expect(content).to.include('trending up')
    } finally {
      await rm(baseDir, {force: true, recursive: true})
    }
  })

  it('detects stable trend correctly', async () => {
    const {baseDir, contributor} = await makeContributor({
      entries: [
        {domain: 'test', score: 0.7},
        {domain: 'test', score: 0.72},
        {domain: 'test', score: 0.71},
        {domain: 'test', score: 0.73},
      ],
    })

    try {
      const content = await contributor.getContent(curateContext())
      expect(content).to.include('stable')
    } finally {
      await rm(baseDir, {force: true, recursive: true})
    }
  })

  it('defaults maxEntries to 10 per domain (verified via output)', async () => {
    // 12 entries all scoring 0.1, then 2 entries scoring 0.9
    // With window=10 (default): last 10 = 8×0.1 + 2×0.9 = 2.6/10 = 0.26
    // With window=14 (all):     12×0.1 + 2×0.9 = 3.0/14 ≈ 0.21
    const entries: Array<{domain: string; score: number}> = []
    for (let i = 0; i < 12; i++) {
      entries.push({domain: 'test', score: 0.1})
    }

    entries.push({domain: 'test', score: 0.9}, {domain: 'test', score: 0.9})

    // Do NOT pass maxEntries — uses the default
    const {baseDir, contributor} = await makeContributor({entries})

    try {
      const content = await contributor.getContent(curateContext())
      // Default 10-entry window: avg = (8*0.1 + 2*0.9)/10 = 0.26
      expect(content).to.include('0.26')
      // NOT 0.21 which would be all-14 average
      expect(content).not.to.include('0.21')
    } finally {
      await rm(baseDir, {force: true, recursive: true})
    }
  })
})
