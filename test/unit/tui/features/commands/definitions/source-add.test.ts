import {expect} from 'chai'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {sourceAddSubCommand} from '../../../../../../src/tui/features/commands/definitions/source-add.js'

function createProject(dir: string): void {
  mkdirSync(join(dir, '.brv'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
}

function readSourcesFile(projectRoot: string): {sources: Array<{alias: string; projectRoot: string}>; version: number} {
  return JSON.parse(readFileSync(join(projectRoot, '.brv', 'sources.json'), 'utf8'))
}

describe('/source add slash command', () => {
  let originalCwd: string
  let testDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-tui-source-add-')))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(testDir, {force: true, recursive: true})
  })

  it('should reject empty arguments with usage hint', async () => {
    const project = join(testDir, 'project')
    createProject(project)
    process.chdir(project)

    const result = await sourceAddSubCommand.action!({}, '')

    expect(result).to.deep.include({
      messageType: 'error',
      type: 'message',
    })
    if (result && 'content' in result) {
      expect(result.content).to.include('Usage: /source add')
    }
  })

  it('should add a source using the directory name as default alias', async () => {
    const projectA = join(testDir, 'project-a')
    const projectB = join(testDir, 'project-b')
    createProject(projectA)
    createProject(projectB)

    process.chdir(projectA)

    const result = await sourceAddSubCommand.action!({}, projectB)

    expect(result).to.deep.include({
      messageType: 'info',
      type: 'message',
    })
    expect(existsSync(join(projectA, '.brv', 'sources.json'))).to.be.true
    const data = readSourcesFile(projectA)
    expect(data.sources).to.have.length(1)
    expect(data.sources[0].alias).to.equal('project-b')
    expect(data.sources[0].projectRoot).to.equal(projectB)
  })

  it('should honor --alias flag when provided', async () => {
    const projectA = join(testDir, 'project-a')
    const projectB = join(testDir, 'project-b')
    createProject(projectA)
    createProject(projectB)

    process.chdir(projectA)

    const result = await sourceAddSubCommand.action!({}, `${projectB} --alias custom`)

    expect(result).to.deep.include({
      messageType: 'info',
      type: 'message',
    })
    const data = readSourcesFile(projectA)
    expect(data.sources).to.have.length(1)
    expect(data.sources[0].alias).to.equal('custom')
  })

  it('should return error when no local project exists', async () => {
    const empty = join(testDir, 'empty')
    mkdirSync(empty, {recursive: true})
    process.chdir(empty)

    const result = await sourceAddSubCommand.action!({}, '/some/path')

    expect(result).to.deep.include({
      messageType: 'error',
      type: 'message',
    })
    if (result && 'content' in result) {
      expect(result.content).to.include('No ByteRover project found')
    }
  })
})
