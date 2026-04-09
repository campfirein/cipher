import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE, WORKTREE_LINK_FILE} from '../../../../src/server/constants.js'
import {
  BrokenWorktreeLinkError,
  findNearestWorktreeLink,
  MalformedWorktreeLinkError,
  resolveProject,
} from '../../../../src/server/infra/project/resolve-project.js'

function createBrvConfig(dir: string): void {
  const brvDir = join(dir, BRV_DIR)
  mkdirSync(brvDir, {recursive: true})
  writeFileSync(join(brvDir, PROJECT_CONFIG_FILE), JSON.stringify({version: '0.0.1'}))
}

function createWorkspaceLink(dir: string, projectRoot: string): void {
  writeFileSync(join(dir, WORKTREE_LINK_FILE), JSON.stringify({projectRoot}))
}

function createGitRoot(dir: string): void {
  mkdirSync(join(dir, '.git'), {recursive: true})
}

describe('resolve-project', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-resolve-test-')))
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('resolveProject - step 1: --project-root flag', () => {
    it('should resolve from explicit flag when target has .brv/', () => {
      createBrvConfig(testDir)

      const result = resolveProject({cwd: '/tmp', projectRootFlag: testDir})

      expect(result).to.not.be.null
      expect(result!.source).to.equal('flag')
      expect(result!.projectRoot).to.equal(testDir)
      expect(result!.worktreeRoot).to.equal(testDir)
    })

    it('should return null when flag points to dir without .brv/', () => {
      const result = resolveProject({cwd: '/tmp', projectRootFlag: testDir})

      expect(result).to.be.null
    })
  })

  describe('step 2: direct .brv/ at cwd', () => {
    it('should resolve direct when cwd has .brv/', () => {
      createBrvConfig(testDir)

      const result = resolveProject({cwd: testDir})

      expect(result).to.not.be.null
      expect(result!.source).to.equal('direct')
      expect(result!.projectRoot).to.equal(testDir)
      expect(result!.worktreeRoot).to.equal(testDir)
      expect(result!.shadowedLink).to.be.undefined
    })

    it('should detect shadowed link when both .brv/ and .brv-worktree.json exist', () => {
      createBrvConfig(testDir)
      createWorkspaceLink(testDir, testDir)

      const result = resolveProject({cwd: testDir})

      expect(result).to.not.be.null
      expect(result!.source).to.equal('direct')
      expect(result!.shadowedLink).to.equal(true)
    })
  })

  describe('step 3: linked via .brv-worktree.json', () => {
    it('should resolve linked workspace from subdirectory', () => {
      createBrvConfig(testDir)
      const subDir = join(testDir, 'packages', 'api')
      mkdirSync(subDir, {recursive: true})
      createWorkspaceLink(subDir, testDir)

      const result = resolveProject({cwd: subDir})

      expect(result).to.not.be.null
      expect(result!.source).to.equal('linked')
      expect(result!.projectRoot).to.equal(testDir)
      expect(result!.worktreeRoot).to.equal(subDir)
      expect(result!.linkFile).to.equal(join(subDir, WORKTREE_LINK_FILE))
    })

    it('should pick nearest link in multi-link ambiguity', () => {
      createBrvConfig(testDir)
      const packages = join(testDir, 'packages')
      const api = join(packages, 'api')
      const src = join(api, 'src')
      mkdirSync(src, {recursive: true})

      createWorkspaceLink(packages, testDir)
      createWorkspaceLink(api, testDir)

      const result = resolveProject({cwd: src})

      expect(result).to.not.be.null
      expect(result!.source).to.equal('linked')
      expect(result!.worktreeRoot).to.equal(api)
    })

    it('should throw BrokenWorktreeLinkError when target has no .brv/', () => {
      const subDir = join(testDir, 'packages', 'api')
      mkdirSync(subDir, {recursive: true})
      createWorkspaceLink(subDir, join(testDir, 'nonexistent'))

      expect(() => resolveProject({cwd: subDir})).to.throw(BrokenWorktreeLinkError)
    })

    it('should throw BrokenWorktreeLinkError when target .brv/ is gone', () => {
      const projectDir = join(testDir, 'project')
      mkdirSync(projectDir, {recursive: true})
      // No .brv/ created at projectDir

      const subDir = join(testDir, 'packages', 'api')
      mkdirSync(subDir, {recursive: true})
      createWorkspaceLink(subDir, projectDir)

      expect(() => resolveProject({cwd: subDir})).to.throw(BrokenWorktreeLinkError)
    })

    it('should throw MalformedWorktreeLinkError for invalid JSON', () => {
      const subDir = join(testDir, 'packages', 'api')
      mkdirSync(subDir, {recursive: true})
      writeFileSync(join(subDir, WORKTREE_LINK_FILE), 'not json{{{')

      expect(() => resolveProject({cwd: subDir})).to.throw(MalformedWorktreeLinkError, /invalid JSON/)
    })

    it('should throw MalformedWorktreeLinkError for missing projectRoot field', () => {
      const subDir = join(testDir, 'packages', 'api')
      mkdirSync(subDir, {recursive: true})
      writeFileSync(join(subDir, WORKTREE_LINK_FILE), JSON.stringify({wrong: 'field'}))

      expect(() => resolveProject({cwd: subDir})).to.throw(MalformedWorktreeLinkError, /missing or invalid/)
    })
  })

  describe('step 4: walked-up .brv/', () => {
    it('should walk up to find .brv/ in ancestor', () => {
      createBrvConfig(testDir)
      const deep = join(testDir, 'packages', 'api', 'src')
      mkdirSync(deep, {recursive: true})

      const result = resolveProject({cwd: deep})

      expect(result).to.not.be.null
      expect(result!.source).to.equal('walked-up')
      expect(result!.projectRoot).to.equal(testDir)
      expect(result!.worktreeRoot).to.equal(testDir)
    })
  })

  describe('step 5: null', () => {
    it('should return null when no project found', () => {
      const emptyDir = join(testDir, 'empty')
      mkdirSync(emptyDir, {recursive: true})
      createGitRoot(emptyDir)

      const result = resolveProject({cwd: emptyDir})

      expect(result).to.be.null
    })
  })

  describe('git root boundary', () => {
    it('should stop walk-up at .git directory', () => {
      // Create .brv/ above the git root — should NOT be found
      createBrvConfig(testDir)
      const repo = join(testDir, 'repo')
      mkdirSync(repo, {recursive: true})
      createGitRoot(repo)
      const deep = join(repo, 'src')
      mkdirSync(deep, {recursive: true})

      const result = resolveProject({cwd: deep})

      // Should stop at repo/ (git root), not find testDir/.brv/
      expect(result).to.be.null
    })

    it('should find .brv/ at git root itself', () => {
      const repo = join(testDir, 'repo')
      mkdirSync(repo, {recursive: true})
      createBrvConfig(repo)
      createGitRoot(repo)
      const deep = join(repo, 'src')
      mkdirSync(deep, {recursive: true})

      const result = resolveProject({cwd: deep})

      expect(result).to.not.be.null
      expect(result!.projectRoot).to.equal(repo)
      expect(result!.source).to.equal('walked-up')
    })

    it('should stop at .git file (worktree/submodule)', () => {
      createBrvConfig(testDir)
      const worktree = join(testDir, 'worktree')
      mkdirSync(worktree, {recursive: true})
      // .git as a file (worktree style)
      writeFileSync(join(worktree, '.git'), 'gitdir: /somewhere/else')
      const deep = join(worktree, 'src')
      mkdirSync(deep, {recursive: true})

      const result = resolveProject({cwd: deep})

      expect(result).to.be.null
    })
  })

  describe('findNearestWorktreeLink', () => {
    it('should find link file at cwd', () => {
    writeFileSync(join(testDir, WORKTREE_LINK_FILE), JSON.stringify({projectRoot: '/some/path'}))

    const result = findNearestWorktreeLink(testDir)

    expect(result).to.equal(join(testDir, WORKTREE_LINK_FILE))
  })

  it('should find link file in ancestor', () => {
    writeFileSync(join(testDir, WORKTREE_LINK_FILE), JSON.stringify({projectRoot: '/some/path'}))
    const deep = join(testDir, 'a', 'b')
    mkdirSync(deep, {recursive: true})

    const result = findNearestWorktreeLink(deep)

    expect(result).to.equal(join(testDir, WORKTREE_LINK_FILE))
  })

  it('should return null when no link file exists', () => {
    const result = findNearestWorktreeLink(testDir)

    expect(result).to.be.null
  })
  })
})
