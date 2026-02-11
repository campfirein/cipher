import {expect} from 'chai'
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {detectMcpMode} from '../../../../src/server/infra/mcp/mcp-mode-detector.js'

describe('detectMcpMode', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `brv-mcp-mode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, {recursive: true})
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, {force: true, recursive: true})
    }
  })

  it('should return "project" with projectRoot when .brv/config.json exists in working directory', () => {
    const brvDir = join(testDir, '.brv')
    mkdirSync(brvDir, {recursive: true})
    writeFileSync(join(brvDir, 'config.json'), '{}')

    const result = detectMcpMode(testDir)
    expect(result.mode).to.equal('project')
    expect(result.projectRoot).to.equal(testDir)
  })

  it('should return "project" with projectRoot pointing to ancestor when .brv/config.json exists in ancestor directory', () => {
    const brvDir = join(testDir, '.brv')
    mkdirSync(brvDir, {recursive: true})
    writeFileSync(join(brvDir, 'config.json'), '{}')

    const nestedDir = join(testDir, 'src', 'components')
    mkdirSync(nestedDir, {recursive: true})

    const result = detectMcpMode(nestedDir)
    expect(result.mode).to.equal('project')
    expect(result.projectRoot).to.equal(testDir)
  })

  it('should return "global" with no projectRoot when no .brv/config.json exists in any ancestor', () => {
    // testDir has no .brv directory
    const result = detectMcpMode(testDir)
    expect(result.mode).to.equal('global')
    expect(result.projectRoot).to.be.undefined
  })

  it('should return "global" when .brv exists but config.json is missing', () => {
    const brvDir = join(testDir, '.brv')
    mkdirSync(brvDir, {recursive: true})
    // No config.json inside .brv

    const result = detectMcpMode(testDir)
    expect(result.mode).to.equal('global')
    expect(result.projectRoot).to.be.undefined
  })

  it('should return "global" for filesystem root', () => {
    const result = detectMcpMode('/')
    expect(result.mode).to.equal('global')
    expect(result.projectRoot).to.be.undefined
  })
})
