import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import WorktreeList from '../../src/oclif/commands/worktree/list.js'
import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../src/server/constants.js'

function createBrvConfig(dir: string): void {
  const brvDir = join(dir, BRV_DIR)
  mkdirSync(brvDir, {recursive: true})
  writeFileSync(join(brvDir, PROJECT_CONFIG_FILE), JSON.stringify({version: '0.0.1'}))
}

/**
 * Create a .brv pointer FILE (not directory) in the target, pointing to projectRoot.
 * The target must NOT already have a .brv/ directory.
 */
function createWorktreePointer(dir: string, projectRoot: string): void {
  writeFileSync(join(dir, BRV_DIR), JSON.stringify({projectRoot}, null, 2) + '\n')
}

describe('worktree list command', () => {
  let config: Awaited<ReturnType<typeof OclifConfig.load>>
  let loggedMessages: string[]
  let originalCwd: string
  let testDir: string

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedMessages = []
    originalCwd = process.cwd()
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-worktree-list-')))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(testDir, {force: true, recursive: true})
    restore()
  })

  function createCommand(): WorktreeList {
    const cmd = new WorktreeList([], config)
    stub(cmd, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })
    return cmd
  }

  it('should show worktree details when running from a linked directory', async () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(testDir, 'workspace')
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)
    createWorktreePointer(workspace, projectRoot)

    process.chdir(workspace)

    await createCommand().run()

    expect(loggedMessages).to.include(`Worktree: ${workspace}`)
    expect(loggedMessages).to.include(`Linked to: ${projectRoot}`)
  })

  it('should report project when running inside project root', async () => {
    const projectRoot = join(testDir, 'project')
    mkdirSync(projectRoot, {recursive: true})
    createBrvConfig(projectRoot)

    process.chdir(projectRoot)

    await createCommand().run()

    expect(loggedMessages).to.include(`Project: ${projectRoot}`)
  })

  it('should report no project when .brv does not exist', async () => {
    const empty = join(testDir, 'empty')
    mkdirSync(empty, {recursive: true})

    process.chdir(empty)

    await createCommand().run()

    expect(loggedMessages).to.include('No ByteRover project found in current directory.')
  })

  it('should exit with error when worktree pointer target is broken', async () => {
    const workspace = join(testDir, 'workspace')
    mkdirSync(workspace, {recursive: true})
    createWorktreePointer(workspace, '/missing/project/path')

    process.chdir(workspace)

    const cmd = createCommand()
    let caughtError: Error | undefined
    try {
      await cmd.run()
    } catch (error) {
      caughtError = error as Error
    }

    expect(caughtError).to.not.be.undefined
    expect(caughtError!.message).to.include('Worktree pointer broken')
  })
})
