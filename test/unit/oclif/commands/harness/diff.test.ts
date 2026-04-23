import {expect} from 'chai'

import type {HarnessVersion} from '../../../../../src/agent/core/domain/harness/types.js'

import {
  buildDiffReport,
  renderDiffText,
} from '../../../../../src/oclif/commands/harness/diff.js'

function makeVersion(overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code: 'exports.curate = async () => {}',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.5,
    id: 'v-default',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*'],
      version: 1,
    },
    projectId: '/fixture/proj',
    projectType: 'typescript',
    version: 1,
    ...overrides,
  }
}

describe('HarnessDiff command — buildDiffReport + renderDiffText', () => {
  describe('buildDiffReport', () => {
    it('1. identical code → empty unifiedDiff + zero adds/deletes', () => {
      const v = makeVersion()
      const report = buildDiffReport(v, {...v, id: 'v-copy'})
      expect(report.fromVersionId).to.equal('v-default')
      expect(report.toVersionId).to.equal('v-copy')
      expect(report.unifiedDiff).to.equal('')
      expect(report.lineAdds).to.equal(0)
      expect(report.lineDeletes).to.equal(0)
    })

    it('2. line-level change produces +/- markers and accurate counts', () => {
      const from = makeVersion({code: 'line1\nline2-old\nline3', id: 'v-a'})
      const to = makeVersion({code: 'line1\nline2-new\nline3', id: 'v-b'})
      const report = buildDiffReport(from, to)
      expect(report.lineAdds).to.equal(1)
      expect(report.lineDeletes).to.equal(1)
      expect(report.unifiedDiff).to.include('-line2-old')
      expect(report.unifiedDiff).to.include('+line2-new')
      expect(report.unifiedDiff).to.include('--- v-a')
      expect(report.unifiedDiff).to.include('+++ v-b')
    })

    it('3. pure insertion reports lineAdds > 0 and lineDeletes == 0', () => {
      const from = makeVersion({code: 'a', id: 'v-a'})
      const to = makeVersion({code: 'a\nb\nc', id: 'v-b'})
      const report = buildDiffReport(from, to)
      expect(report.lineAdds).to.equal(2)
      expect(report.lineDeletes).to.equal(0)
    })
  })

  describe('renderDiffText', () => {
    it('1. identical versions render as a single informative line', () => {
      const text = renderDiffText({
        fromVersionId: 'v-a',
        lineAdds: 0,
        lineDeletes: 0,
        toVersionId: 'v-b',
        unifiedDiff: '',
      })
      expect(text).to.include('v-a == v-b')
      expect(text).to.include('identical')
    })

    it('2. non-empty diff trails with +N additions / -M deletions summary', () => {
      const text = renderDiffText({
        fromVersionId: 'v-a',
        lineAdds: 3,
        lineDeletes: 2,
        toVersionId: 'v-b',
        unifiedDiff: '--- v-a\n+++ v-b\n-x\n+y',
      })
      expect(text).to.include('--- v-a')
      expect(text).to.include('+3 additions, -2 deletions')
    })
  })
})
