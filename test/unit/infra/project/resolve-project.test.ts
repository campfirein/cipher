import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../../../src/server/constants.js'
import {
  BrokenWorktreePointerError,
  MalformedWorktreePointerError,
  resolveProject,
} from '../../../../src/server/infra/project/resolve-project.js'

function createBrvConfig(dir: string): void {
  const brvDir = join(dir, BRV_DIR)
  mkdirSync(brvDir, {recursive: true})
  writeFileSync(join(brvDir, PROJECT_CONFIG_FILE), JSON.stringify({version: '0.0.1'}))
}

function createWorktreePointer(dir: string, projectRoot: string): void {
  writeFileSync(join(dir, BRV_DIR), JSON.stringify({projectRoot}))
}

describe('resolve-project', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-resolve-')))
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('step 1: --project-root flag', () => {
    it('should use flag when provided and valid', () => {
      createBrvConfig(testDir)

      const result = resolveProject({cwd: '/tmp', projectRootFlag: testDir})
      expect(result).to.not.be.null
      expect(result!.source).to.equal('flag')
      expect(result!.projectRoot).to.equal(testDir)
      expect(result!.worktreeRoot).to.equal(testDir)
    })

    it('should throw when flag path has no .brv/config.json', () => {
      expect(() => resolveProject({cwd: testDir, projectRootFlag: testDir})).to.throw(
        'not a ByteRover project',
      )
    })
  })

  describe('step 2: .brv is a directory (direct)', () => {
    it('should return direct when .brv/ has config.json', () => {
      createBrvConfig(testDir)

      const result = resolveProject({cwd: testDir})
      expect(result).to.not.be.null
      expect(result!.source).to.equal('direct')
      expect(result!.projectRoot).to.equal(testDir)
      expect(result!.worktreeRoot).to.equal(testDir)
    })

    it('should return null when .brv/ exists but has no config.json', () => {
      mkdirSync(join(testDir, BRV_DIR), {recursive: true})

      const result = resolveProject({cwd: testDir})
      expect(result).to.be.null
    })
  })

  describe('step 3: .brv is a file (linked)', () => {
    it('should follow pointer to parent project', () => {
      const projectRoot = join(testDir, 'project')
      const workspace = join(testDir, 'workspace')
      mkdirSync(projectRoot, {recursive: true})
      mkdirSync(workspace, {recursive: true})
      createBrvConfig(projectRoot)
      createWorktreePointer(workspace, projectRoot)

      const result = resolveProject({cwd: workspace})
      expect(result).to.not.be.null
      expect(result!.source).to.equal('linked')
      expect(result!.projectRoot).to.equal(projectRoot)
      expect(result!.worktreeRoot).to.equal(workspace)
    })

    it('should throw BrokenWorktreePointerError when target has no .brv/', () => {
      const workspace = join(testDir, 'workspace')
      mkdirSync(workspace, {recursive: true})
      createWorktreePointer(workspace, join(testDir, 'nonexistent'))

      expect(() => resolveProject({cwd: workspace})).to.throw(BrokenWorktreePointerError)
    })

    it('should throw BrokenWorktreePointerError when target .brv/ lost config', () => {
      const projectRoot = join(testDir, 'project')
      const workspace = join(testDir, 'workspace')
      mkdirSync(projectRoot, {recursive: true})
      mkdirSync(workspace, {recursive: true})
      createBrvConfig(projectRoot)
      createWorktreePointer(workspace, projectRoot)

      // Delete parent's config
      rmSync(join(projectRoot, BRV_DIR), {force: true, recursive: true})

      expect(() => resolveProject({cwd: workspace})).to.throw(BrokenWorktreePointerError)
    })

    it('should throw MalformedWorktreePointerError for invalid JSON', () => {
      const workspace = join(testDir, 'workspace')
      mkdirSync(workspace, {recursive: true})
      writeFileSync(join(workspace, BRV_DIR), 'not json')

      expect(() => resolveProject({cwd: workspace})).to.throw(MalformedWorktreePointerError)
    })

    it('should throw MalformedWorktreePointerError for missing projectRoot field', () => {
      const workspace = join(testDir, 'workspace')
      mkdirSync(workspace, {recursive: true})
      writeFileSync(join(workspace, BRV_DIR), JSON.stringify({notProjectRoot: '/foo'}))

      expect(() => resolveProject({cwd: workspace})).to.throw(MalformedWorktreePointerError)
    })
  })

  describe('step 4: .brv absent', () => {
    it('should return null when no .brv exists', () => {
      const result = resolveProject({cwd: testDir})
      expect(result).to.be.null
    })
  })

  describe('walk-up behavior', () => {
    it('should find parent .brv/ when cwd has no .brv (like git)', () => {
      // Parent has .brv/, child has nothing — resolver walks up (like git finding .git/)
      createBrvConfig(testDir)
      const subDir = join(testDir, 'packages', 'api')
      mkdirSync(subDir, {recursive: true})

      const result = resolveProject({cwd: subDir})
      expect(result).to.not.be.null
      expect(result!.source).to.equal('direct')
      expect(result!.projectRoot).to.equal(testDir)
    })
  })
})
