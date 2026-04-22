import {expect} from 'chai'

import type {HarnessVersion} from '../../../../../src/agent/core/domain/harness/types.js'

import {
  renderInspectText,
  toInspectReport,
} from '../../../../../src/oclif/commands/harness/inspect.js'

function makeVersion(overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code: 'exports.curate = async () => {}',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.72,
    id: 'v-abc',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*'],
      version: 1,
    },
    projectId: '/fixture/proj',
    projectType: 'typescript',
    version: 3,
    ...overrides,
  }
}

describe('HarnessInspect command — toInspectReport + renderInspectText', () => {
  describe('toInspectReport', () => {
    it('1. maps HarnessVersion into the §C2 inspect shape', () => {
      const v = makeVersion({parentId: 'v-parent-x'})
      const report = toInspectReport(v)

      expect(report.id).to.equal('v-abc')
      expect(report.version).to.equal(3)
      expect(report.commandType).to.equal('curate')
      expect(report.projectType).to.equal('typescript')
      expect(report.heuristic).to.equal(0.72)
      expect(report.createdAt).to.equal(1_700_000_000_000)
      expect(report.parentId).to.equal('v-parent-x')
      expect(report.code).to.equal('exports.curate = async () => {}')
      expect(report.metadata).to.deep.equal({
        capabilities: ['curate'],
        commandType: 'curate',
        projectPatterns: ['**/*'],
        version: 1,
      })
    })

    it('2. normalises missing parentId to null (not undefined) — stable JSON shape', () => {
      const v = makeVersion()
      const report = toInspectReport(v)
      expect(report.parentId).to.equal(null)
    })
  })

  describe('renderInspectText', () => {
    it('includes id, version, pair, created timestamp, parent, and code', () => {
      const v = makeVersion({parentId: 'v-parent-x'})
      const text = renderInspectText(toInspectReport(v))

      expect(text).to.include('id:        v-abc')
      expect(text).to.include('version:   #3')
      expect(text).to.include('pair:      (/fixture/proj, curate)')
      expect(text).to.include('H:         0.7200')
      expect(text).to.include('parent:    v-parent-x')
      expect(text).to.include('── code ──')
      expect(text).to.include('exports.curate')
    })

    it('labels bootstrap versions ("<none — bootstrap>") when parentId is null', () => {
      const v = makeVersion()
      const text = renderInspectText(toInspectReport(v))
      expect(text).to.include('<none — bootstrap>')
    })
  })
})
