/**
 * Integration tests for worktree lifecycle.
 *
 * Exercises the git-style worktree model: .brv as directory (real project)
 * or .brv as file (pointer to parent). Uses real filesystem (tmpdir). No mocks.
 */

import {expect} from 'chai'
import {existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../../src/server/constants.js'
import {
  addWorktree,
  BrokenWorktreePointerError,
  isWorktreePointer,
  listWorktrees,
  MalformedWorktreePointerError,
  removeWorktree,
  resolveProject,
} from '../../../src/server/infra/project/resolve-project.js'

function createBrvConfig(dir: string): void {
  const brvDir = join(dir, BRV_DIR)
  mkdirSync(brvDir, {recursive: true})
  writeFileSync(join(brvDir, PROJECT_CONFIG_FILE), JSON.stringify({version: '0.0.1'}))
}

describe('worktree lifecycle (integration)', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-lifecycle-')))
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  it('should resolve through full add → resolve → remove → resolve cycle', () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(testDir, 'workspace')
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)

    // Before adding: workspace has no .brv → null
    const before = resolveProject({cwd: workspace})
    expect(before).to.be.null

    // Add worktree
    const addResult = addWorktree(projectRoot, workspace)
    expect(addResult.success).to.be.true

    // After adding: .brv is a FILE (pointer), resolves as linked
    expect(isWorktreePointer(workspace)).to.be.true
    const linked = resolveProject({cwd: workspace})
    expect(linked).to.not.be.null
    expect(linked!.source).to.equal('linked')
    expect(linked!.projectRoot).to.equal(projectRoot)
    expect(linked!.worktreeRoot).to.equal(workspace)

    // Remove worktree
    const removeResult = removeWorktree(workspace)
    expect(removeResult.success).to.be.true

    // After removing: .brv gone → null
    expect(isWorktreePointer(workspace)).to.be.false
    const afterRemove = resolveProject({cwd: workspace})
    expect(afterRemove).to.be.null
  })

  it('should handle child directory (monorepo subdirectory)', () => {
    const projectRoot = join(testDir, 'monorepo')
    const workspace = join(projectRoot, 'packages', 'api')
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)

    const addResult = addWorktree(projectRoot, workspace)
    expect(addResult.success).to.be.true

    const result = resolveProject({cwd: workspace})
    expect(result!.source).to.equal('linked')
    expect(result!.projectRoot).to.equal(projectRoot)
    expect(result!.worktreeRoot).to.equal(workspace)
  })

  it('should handle sibling directory', () => {
    const projectRoot = join(testDir, 'main-project')
    const sibling = join(testDir, 'feature-checkout')
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(sibling, {recursive: true})
    createBrvConfig(projectRoot)

    const addResult = addWorktree(projectRoot, sibling)
    expect(addResult.success).to.be.true

    const result = resolveProject({cwd: sibling})
    expect(result!.source).to.equal('linked')
    expect(result!.projectRoot).to.equal(projectRoot)
    expect(result!.worktreeRoot).to.equal(sibling)
  })

  it('should be idempotent when adding same worktree twice', () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(testDir, 'workspace')
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)

    addWorktree(projectRoot, workspace)
    const second = addWorktree(projectRoot, workspace)
    expect(second.success).to.be.true
    expect(second.message).to.include('Already registered')
  })

  it('should register worktree in parent registry', () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(testDir, 'workspace')
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)

    addWorktree(projectRoot, workspace)

    const worktrees = listWorktrees(projectRoot)
    expect(worktrees).to.have.length(1)
    expect(worktrees[0].worktreePath).to.equal(workspace)
  })

  it('should clean up registry on remove', () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(testDir, 'workspace')
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)

    addWorktree(projectRoot, workspace)
    expect(listWorktrees(projectRoot)).to.have.length(1)

    removeWorktree(workspace)
    expect(listWorktrees(projectRoot)).to.have.length(0)
  })

  it('should back up existing .brv/ directory when adding with force', () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(testDir, 'workspace')
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)
    createBrvConfig(workspace)

    // Without force: rejected
    const withoutForce = addWorktree(projectRoot, workspace)
    expect(withoutForce.success).to.be.false
    expect(withoutForce.message).to.include('--force')

    // With force: backed up
    const withForce = addWorktree(projectRoot, workspace, {force: true})
    expect(withForce.success).to.be.true
    expect(withForce.backedUp).to.be.true

    // .brv is now a file, not directory
    expect(lstatSync(join(workspace, BRV_DIR)).isFile()).to.be.true

    // Backup exists
    expect(existsSync(join(workspace, '.brv-backup', PROJECT_CONFIG_FILE))).to.be.true
  })

  it('should restore backup on remove', () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(testDir, 'workspace')
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)
    createBrvConfig(workspace)

    addWorktree(projectRoot, workspace, {force: true})
    removeWorktree(workspace)

    // .brv should be restored as a directory from backup
    expect(lstatSync(join(workspace, BRV_DIR)).isDirectory()).to.be.true
    expect(existsSync(join(workspace, BRV_DIR, PROJECT_CONFIG_FILE))).to.be.true
    expect(existsSync(join(workspace, '.brv-backup'))).to.be.false
  })

  it('should throw BrokenWorktreePointerError when pointer target is gone', () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(testDir, 'workspace')
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)
    addWorktree(projectRoot, workspace)

    rmSync(join(projectRoot, BRV_DIR), {force: true, recursive: true})

    expect(() => resolveProject({cwd: workspace})).to.throw(BrokenWorktreePointerError)
  })

  it('should throw MalformedWorktreePointerError for invalid .brv file', () => {
    const workspace = join(testDir, 'workspace')
    mkdirSync(workspace, {recursive: true})
    writeFileSync(join(workspace, BRV_DIR), 'not json at all')

    expect(() => resolveProject({cwd: workspace})).to.throw(MalformedWorktreePointerError)
  })

  it('should return null when .brv does not exist', () => {
    const emptyDir = join(testDir, 'empty')
    mkdirSync(emptyDir, {recursive: true})

    expect(resolveProject({cwd: emptyDir})).to.be.null
  })

  it('should return direct when .brv is a directory with config', () => {
    const projectRoot = join(testDir, 'project')
    mkdirSync(projectRoot, {recursive: true})
    createBrvConfig(projectRoot)

    const result = resolveProject({cwd: projectRoot})
    expect(result!.source).to.equal('direct')
    expect(result!.projectRoot).to.equal(projectRoot)
    expect(result!.worktreeRoot).to.equal(projectRoot)
  })

  it('should reject self as worktree', () => {
    const projectRoot = join(testDir, 'project')
    mkdirSync(projectRoot, {recursive: true})
    createBrvConfig(projectRoot)

    const result = addWorktree(projectRoot, projectRoot)
    expect(result.success).to.be.false
  })

  it('should assign unique registry names when sanitized paths collide', () => {
    const projectRoot = join(testDir, 'monorepo')
    // Two directories whose sanitized names both become "packages-api"
    const worktreeA = join(testDir, 'packages-api')
    const worktreeB = join(projectRoot, 'packages', 'api') // relative: packages/api → packages-api
    mkdirSync(projectRoot, {recursive: true})
    mkdirSync(worktreeA, {recursive: true})
    mkdirSync(worktreeB, {recursive: true})
    createBrvConfig(projectRoot)

    const resultA = addWorktree(projectRoot, worktreeA)
    expect(resultA.success).to.be.true

    const resultB = addWorktree(projectRoot, worktreeB)
    expect(resultB.success).to.be.true

    const worktrees = listWorktrees(projectRoot)
    expect(worktrees).to.have.length(2)

    // Names must be distinct
    const names = worktrees.map((w) => w.name)
    expect(new Set(names).size).to.equal(2)
    expect(names).to.include('packages-api')
    expect(names).to.include('packages-api-2')
  })
})
