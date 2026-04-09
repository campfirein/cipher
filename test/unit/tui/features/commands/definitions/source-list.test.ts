import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {addSource} from '../../../../../../src/server/core/domain/source/source-operations.js'
import {sourceListSubCommand} from '../../../../../../src/tui/features/commands/definitions/source-list.js'

function createProject(dir: string): void {
  mkdirSync(join(dir, '.brv'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
}

function createProjectWithContextTree(dir: string): void {
  createProject(dir)
  mkdirSync(join(dir, '.brv', 'context-tree'), {recursive: true})
}

describe('/source list slash command', () => {
  let originalCwd: string
  let testDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-tui-source-list-')))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(testDir, {force: true, recursive: true})
  })

  it('should report no sources configured when none exist', async () => {
    const project = join(testDir, 'project')
    createProject(project)
    process.chdir(project)

    const result = await sourceListSubCommand.action!({}, '')

    expect(result).to.deep.include({
      messageType: 'info',
      type: 'message',
    })
    if (result && 'content' in result) {
      expect(result.content).to.include('No knowledge sources configured.')
    }
  })

  it('should list configured sources with their status', async () => {
    const projectA = join(testDir, 'project-a')
    const projectB = join(testDir, 'project-b')
    createProjectWithContextTree(projectA)
    createProjectWithContextTree(projectB)
    addSource(projectA, projectB, 'shared-lib')

    process.chdir(projectA)

    const result = await sourceListSubCommand.action!({}, '')

    expect(result).to.deep.include({
      messageType: 'info',
      type: 'message',
    })
    if (result && 'content' in result) {
      expect(result.content).to.include('Knowledge Sources:')
      expect(result.content).to.include('shared-lib')
      expect(result.content).to.include(projectB)
    }
  })

  it('should return error when no project found', async () => {
    const empty = join(testDir, 'empty')
    mkdirSync(empty, {recursive: true})
    process.chdir(empty)

    const result = await sourceListSubCommand.action!({}, '')

    expect(result).to.deep.include({
      messageType: 'error',
      type: 'message',
    })
    if (result && 'content' in result) {
      expect(result.content).to.include('No ByteRover project found')
    }
  })
})
