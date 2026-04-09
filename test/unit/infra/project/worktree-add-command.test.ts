/**
 * Worktree add command validation tests
 *
 * Tests the exported helpers from resolve-project.ts used by `brv worktree add`:
 * - hasBrvConfig: checks for .brv/config.json
 * - isWorktreePointer: checks if .brv is a file (not directory)
 * - isDescendantOf: validates ancestor relationship
 * - addWorktree: creates pointer + registry
 * - findParentProject: walks up to find nearest .brv/ directory
 */

import {expect} from 'chai'
import {lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../../../src/server/constants.js'
import {
  addWorktree,
  findParentProject,
  hasBrvConfig,
  isDescendantOf,
  isGitRoot,
  isWorktreePointer,
} from '../../../../src/server/infra/project/resolve-project.js'

function createBrvConfig(dir: string): void {
  const brvDir = join(dir, BRV_DIR)
  mkdirSync(brvDir, {recursive: true})
  writeFileSync(join(brvDir, PROJECT_CONFIG_FILE), JSON.stringify({version: '0.0.1'}))
}

describe('worktree add command helpers', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-worktree-test-')))
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('hasBrvConfig', () => {
    it('should return true when .brv/config.json exists', () => {
      createBrvConfig(testDir)
      expect(hasBrvConfig(testDir)).to.be.true
    })

    it('should return false when .brv/ does not exist', () => {
      expect(hasBrvConfig(testDir)).to.be.false
    })

    it('should return false when .brv/ exists but config.json is missing', () => {
      mkdirSync(join(testDir, BRV_DIR), {recursive: true})
      expect(hasBrvConfig(testDir)).to.be.false
    })
  })

  describe('isWorktreePointer', () => {
    it('should return true when .brv is a file', () => {
      writeFileSync(join(testDir, BRV_DIR), JSON.stringify({projectRoot: '/some/path'}))
      expect(isWorktreePointer(testDir)).to.be.true
    })

    it('should return false when .brv is a directory', () => {
      mkdirSync(join(testDir, BRV_DIR), {recursive: true})
      expect(isWorktreePointer(testDir)).to.be.false
    })

    it('should return false when .brv does not exist', () => {
      expect(isWorktreePointer(testDir)).to.be.false
    })
  })

  describe('isDescendantOf', () => {
    it('should return true when paths are equal', () => {
      expect(isDescendantOf('/a/b/c', '/a/b/c')).to.be.true
    })

    it('should return true when descendant is a child of ancestor', () => {
      expect(isDescendantOf('/a/b/c/d', '/a/b/c')).to.be.true
    })

    it('should return false when not a descendant', () => {
      expect(isDescendantOf('/a/b/c', '/x/y/z')).to.be.false
    })

    it('should return false for partial prefix matches', () => {
      expect(isDescendantOf('/a/b/cd', '/a/b/c')).to.be.false
    })
  })

  describe('isGitRoot', () => {
    it('should return true when .git directory exists', () => {
      mkdirSync(join(testDir, '.git'), {recursive: true})
      expect(isGitRoot(testDir)).to.be.true
    })

    it('should return true when .git is a file (worktree/submodule)', () => {
      writeFileSync(join(testDir, '.git'), 'gitdir: /some/path')
      expect(isGitRoot(testDir)).to.be.true
    })

    it('should return false when .git does not exist', () => {
      expect(isGitRoot(testDir)).to.be.false
    })
  })

  describe('addWorktree', () => {
    it('should create pointer file and registry entry', () => {
      const projectRoot = join(testDir, 'project')
      const workspace = join(testDir, 'workspace')
      mkdirSync(projectRoot, {recursive: true})
      mkdirSync(workspace, {recursive: true})
      createBrvConfig(projectRoot)

      const result = addWorktree(projectRoot, workspace)

      expect(result.success).to.be.true
      expect(isWorktreePointer(workspace)).to.be.true
      expect(lstatSync(join(workspace, BRV_DIR)).isFile()).to.be.true
    })

    it('should reject when parent is not a project', () => {
      const notProject = join(testDir, 'not-project')
      const workspace = join(testDir, 'workspace')
      mkdirSync(notProject, {recursive: true})
      mkdirSync(workspace, {recursive: true})

      const result = addWorktree(notProject, workspace)
      expect(result.success).to.be.false
      expect(result.message).to.include('not a ByteRover project')
    })

    it('should reject when target does not exist', () => {
      const projectRoot = join(testDir, 'project')
      mkdirSync(projectRoot, {recursive: true})
      createBrvConfig(projectRoot)

      const result = addWorktree(projectRoot, join(testDir, 'nonexistent'))
      expect(result.success).to.be.false
      expect(result.message).to.include('does not exist')
    })

    it('should reject self as worktree', () => {
      const projectRoot = join(testDir, 'project')
      mkdirSync(projectRoot, {recursive: true})
      createBrvConfig(projectRoot)

      const result = addWorktree(projectRoot, projectRoot)
      expect(result.success).to.be.false
    })

    it('should require --force when target has existing .brv/ directory', () => {
      const projectRoot = join(testDir, 'project')
      const workspace = join(testDir, 'workspace')
      mkdirSync(projectRoot, {recursive: true})
      mkdirSync(workspace, {recursive: true})
      createBrvConfig(projectRoot)
      createBrvConfig(workspace)

      const result = addWorktree(projectRoot, workspace)
      expect(result.success).to.be.false
      expect(result.message).to.include('--force')
    })

    it('should be idempotent when pointer already points to same parent', () => {
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
  })

  describe('findParentProject', () => {
    it('should find parent .brv/ directory when walking up', () => {
      createBrvConfig(testDir)
      const subDir = join(testDir, 'packages', 'api')
      mkdirSync(subDir, {recursive: true})

      const parent = findParentProject(subDir)
      expect(parent).to.equal(testDir)
    })

    it('should return undefined when no parent project exists', () => {
      const subDir = join(testDir, 'packages', 'api')
      mkdirSync(subDir, {recursive: true})

      const parent = findParentProject(subDir)
      expect(parent).to.be.undefined
    })

    it('should stop at git boundary', () => {
      const outer = join(testDir, 'outer')
      const inner = join(outer, 'inner')
      const subDir = join(inner, 'src')
      mkdirSync(subDir, {recursive: true})
      createBrvConfig(outer)
      mkdirSync(join(inner, '.git'), {recursive: true})

      const parent = findParentProject(subDir)
      expect(parent).to.be.undefined
    })

    it('should skip .brv files (pointers), only find .brv directories', () => {
      const middle = join(testDir, 'middle')
      const subDir = join(middle, 'src')
      mkdirSync(subDir, {recursive: true})
      writeFileSync(join(middle, BRV_DIR), JSON.stringify({projectRoot: '/some/path'}))

      const parent = findParentProject(subDir)
      expect(parent).to.be.undefined
    })
  })
})
