import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../../../../../src/server/constants.js'
import {worktreeListSubCommand} from '../../../../../../src/tui/features/commands/definitions/worktree-list.js'

function createBrvConfig(dir: string): void {
  const brvDir = join(dir, BRV_DIR)
  mkdirSync(brvDir, {recursive: true})
  writeFileSync(join(brvDir, PROJECT_CONFIG_FILE), JSON.stringify({version: '0.0.1'}))
}

function createWorktreePointer(dir: string, projectRoot: string): void {
  writeFileSync(join(dir, BRV_DIR), JSON.stringify({projectRoot}, null, 2) + '\n')
}

describe('/worktree list slash command', () => {
  let originalCwd: string
  let testDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-tui-worktree-list-')))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(testDir, {force: true, recursive: true})
  })

  it('should report worktree details when running from a linked directory', async () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(testDir, 'workspace')
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)
    createWorktreePointer(workspace, projectRoot)

    process.chdir(workspace)

    const result = await worktreeListSubCommand.action!({}, '')

    expect(result).to.deep.include({
      messageType: 'info',
      type: 'message',
    })
    if (result && 'content' in result) {
      expect(result.content).to.include(`Worktree: ${workspace}`)
      expect(result.content).to.include(`Linked to: ${projectRoot}`)
    }
  })

  it('should report project when running inside project root', async () => {
    const projectRoot = join(testDir, 'project')
    mkdirSync(projectRoot, {recursive: true})
    createBrvConfig(projectRoot)

    process.chdir(projectRoot)

    const result = await worktreeListSubCommand.action!({}, '')

    expect(result).to.deep.include({
      messageType: 'info',
      type: 'message',
    })
    if (result && 'content' in result) {
      expect(result.content).to.include(`Project: ${projectRoot}`)
    }
  })

  it('should return info message when no project found', async () => {
    const empty = join(testDir, 'empty')
    mkdirSync(empty, {recursive: true})
    process.chdir(empty)

    const result = await worktreeListSubCommand.action!({}, '')

    expect(result).to.deep.include({
      messageType: 'info',
      type: 'message',
    })
    if (result && 'content' in result) {
      expect(result.content).to.include('No ByteRover project found')
    }
  })

  it('should return error message when worktree pointer is broken', async () => {
    const workspace = join(testDir, 'workspace')
    mkdirSync(workspace, {recursive: true})
    createWorktreePointer(workspace, '/missing/project/path')

    process.chdir(workspace)

    const result = await worktreeListSubCommand.action!({}, '')

    expect(result).to.deep.include({
      messageType: 'error',
      type: 'message',
    })
    if (result && 'content' in result) {
      expect(result.content).to.include('Worktree pointer broken')
    }
  })
})
