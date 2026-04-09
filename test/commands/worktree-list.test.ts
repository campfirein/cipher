import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {restore, stub} from 'sinon'

import WorktreeList from '../../src/oclif/commands/worktree/list.js'
import {BRV_DIR, PROJECT_CONFIG_FILE, WORKTREE_LINK_FILE} from '../../src/server/constants.js'

function createBrvConfig(dir: string): void {
  const brvDir = join(dir, BRV_DIR)
  mkdirSync(brvDir, {recursive: true})
  writeFileSync(join(brvDir, PROJECT_CONFIG_FILE), JSON.stringify({version: '0.0.1'}))
}

function createWorktreeLink(dir: string, projectRoot: string): void {
  writeFileSync(join(dir, WORKTREE_LINK_FILE), JSON.stringify({projectRoot}, null, 2) + '\n')
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

  it('should show worktree details when running from a linked subdirectory', async () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(projectRoot, 'packages', 'api')
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)
    createWorktreeLink(workspace, projectRoot)

    process.chdir(workspace)

    await createCommand().run()

    expect(loggedMessages).to.include(`Worktree: ${workspace}`)
    expect(loggedMessages).to.include(`Linked to: ${projectRoot}`)
    expect(loggedMessages).to.include(`Link file: ${join(workspace, WORKTREE_LINK_FILE)}`)
  })

  it('should report no worktree link when running inside project root', async () => {
    const projectRoot = join(testDir, 'project')
    mkdirSync(projectRoot, {recursive: true})
    createBrvConfig(projectRoot)

    process.chdir(projectRoot)

    await createCommand().run()

    expect(loggedMessages).to.include(`Project: ${projectRoot}`)
    expect(loggedMessages).to.include('No worktree link (running inside project root).')
  })

  it('should report no project when neither .brv/ nor link exists in any ancestor', async () => {
    const empty = join(testDir, 'empty')
    mkdirSync(empty, {recursive: true})

    process.chdir(empty)

    // No project ancestor found (testDir is under tmpdir which has no .brv/)
    await createCommand().run()

    expect(loggedMessages).to.include('No ByteRover project found in current directory or any ancestor.')
  })

  it('should exit with error when worktree link target is broken', async () => {
    const workspace = join(testDir, 'workspace')
    mkdirSync(workspace, {recursive: true})
    // Link points to a target that does not have .brv/config.json
    createWorktreeLink(workspace, '/missing/project/path')

    process.chdir(workspace)

    const cmd = createCommand()
    let caughtError: Error | undefined
    try {
      await cmd.run()
    } catch (error) {
      caughtError = error as Error
    }

    expect(caughtError).to.not.be.undefined
    expect(caughtError!.message).to.include('Worktree link broken')
  })
})
