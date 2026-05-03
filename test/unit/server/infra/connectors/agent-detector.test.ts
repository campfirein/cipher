import {expect} from 'chai'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {detectAgents} from '../../../../../src/server/infra/connectors/agent-detector.js'

describe('detectAgents', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'brv-agent-detect-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, {force: true, recursive: true})
  })

  it('returns empty array when no agent markers exist', () => {
    const result = detectAgents(tmpRoot)
    expect(result).to.deep.equal([])
  })

  it('detects Claude Code from .claude/ directory', () => {
    mkdirSync(join(tmpRoot, '.claude'))
    const result = detectAgents(tmpRoot)
    expect(result).to.have.lengthOf(1)
    expect(result[0].agent).to.equal('Claude Code')
    expect(result[0].evidence).to.include('.claude')
  })

  it('detects Cursor from .cursor/ directory', () => {
    mkdirSync(join(tmpRoot, '.cursor'))
    const result = detectAgents(tmpRoot)
    expect(result).to.have.lengthOf(1)
    expect(result[0].agent).to.equal('Cursor')
  })

  it('detects multiple agents when multiple markers exist', () => {
    mkdirSync(join(tmpRoot, '.claude'))
    mkdirSync(join(tmpRoot, '.cursor'))
    const result = detectAgents(tmpRoot)
    const agents = result.map((r) => r.agent).sort()
    expect(agents).to.deep.equal(['Claude Code', 'Cursor'])
  })

  it('detects Github Copilot from .github/copilot-instructions.md', () => {
    mkdirSync(join(tmpRoot, '.github'))
    writeFileSync(join(tmpRoot, '.github', 'copilot-instructions.md'), '# rules')
    const result = detectAgents(tmpRoot)
    expect(result.map((r) => r.agent)).to.include('Github Copilot')
  })

  it('does not detect Github Copilot when .github exists but no copilot-instructions.md', () => {
    mkdirSync(join(tmpRoot, '.github'))
    const result = detectAgents(tmpRoot)
    expect(result.map((r) => r.agent)).to.not.include('Github Copilot')
  })

  it('detects Windsurf from .windsurf/ directory', () => {
    mkdirSync(join(tmpRoot, '.windsurf'))
    const result = detectAgents(tmpRoot)
    expect(result.map((r) => r.agent)).to.include('Windsurf')
  })

  it('returns evidence string describing the marker found', () => {
    mkdirSync(join(tmpRoot, '.claude'))
    const result = detectAgents(tmpRoot)
    expect(result[0].evidence).to.be.a('string')
    expect(result[0].evidence.length).to.be.greaterThan(0)
  })

  it('treats projectRoot as absolute and does not walk parent directories', () => {
    const childDir = join(tmpRoot, 'subproject')
    mkdirSync(childDir)
    mkdirSync(join(tmpRoot, '.claude'))
    const result = detectAgents(childDir)
    expect(result).to.deep.equal([])
  })
})
