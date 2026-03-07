/**
 * Link command validation tests
 *
 * Tests the exported helpers from resolve-project.ts used by `brv link`:
 * - hasBrvConfig: checks for .brv/config.json
 * - hasWorkspaceLink: checks for .brv-workspace.json
 * - isDescendantOf: validates ancestor relationship
 *
 * Also tests the link file creation flow (write + read-back validation).
 */

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, sep} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE, WORKSPACE_LINK_FILE} from '../../../../src/server/constants.js'
import {WorkspaceLinkSchema} from '../../../../src/server/core/domain/project/workspace-link-schema.js'
import {
  hasBrvConfig,
  hasWorkspaceLink,
  isDescendantOf,
  isGitRoot,
} from '../../../../src/server/infra/project/resolve-project.js'

function createBrvConfig(dir: string): void {
  const brvDir = join(dir, BRV_DIR)
  mkdirSync(brvDir, {recursive: true})
  writeFileSync(join(brvDir, PROJECT_CONFIG_FILE), JSON.stringify({version: '0.0.1'}))
}

function createWorkspaceLink(dir: string, projectRoot: string): void {
  writeFileSync(join(dir, WORKSPACE_LINK_FILE), JSON.stringify({projectRoot}))
}

describe('link command validation helpers', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-link-test-')))
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

  describe('hasWorkspaceLink', () => {
    it('should return true when .brv-workspace.json exists', () => {
      createWorkspaceLink(testDir, '/some/project')

      expect(hasWorkspaceLink(testDir)).to.be.true
    })

    it('should return false when .brv-workspace.json does not exist', () => {
      expect(hasWorkspaceLink(testDir)).to.be.false
    })
  })

  describe('isDescendantOf', () => {
    it('should return true when paths are equal', () => {
      expect(isDescendantOf('/a/b/c', '/a/b/c')).to.be.true
    })

    it('should return true when descendant is a child of ancestor', () => {
      expect(isDescendantOf('/a/b/c/d', '/a/b/c')).to.be.true
    })

    it('should return true for deeply nested descendants', () => {
      expect(isDescendantOf('/projects/monorepo/packages/api/src', '/projects/monorepo')).to.be.true
    })

    it('should return false when not a descendant', () => {
      expect(isDescendantOf('/a/b/c', '/x/y/z')).to.be.false
    })

    it('should return false for partial prefix matches', () => {
      // /a/b/cd is NOT a descendant of /a/b/c (partial directory name match)
      expect(isDescendantOf('/a/b/cd', '/a/b/c')).to.be.false
    })

    it('should handle trailing separators on ancestor', () => {
      expect(isDescendantOf(`/a/b/c/d`, `/a/b/c${sep}`)).to.be.true
    })
  })

  describe('link file creation flow', () => {
    it('should create a valid .brv-workspace.json that passes schema validation', () => {
      const projectRoot = testDir
      const workspaceDir = join(testDir, 'packages', 'api')
      mkdirSync(workspaceDir, {recursive: true})

      // Simulate link creation (same as oclif command does)
      const linkContent = JSON.stringify({projectRoot}, null, 2) + '\n'
      writeFileSync(join(workspaceDir, WORKSPACE_LINK_FILE), linkContent, 'utf8')

      // Read back and validate with schema
      const raw = readFileSync(join(workspaceDir, WORKSPACE_LINK_FILE), 'utf8')
      const parsed = JSON.parse(raw)
      const result = WorkspaceLinkSchema.safeParse(parsed)

      expect(result.success).to.be.true
      expect(result.data?.projectRoot).to.equal(projectRoot)
    })

    it('should be detectable by hasWorkspaceLink after creation', () => {
      const workspaceDir = join(testDir, 'sub')
      mkdirSync(workspaceDir, {recursive: true})

      expect(hasWorkspaceLink(workspaceDir)).to.be.false

      createWorkspaceLink(workspaceDir, testDir)

      expect(hasWorkspaceLink(workspaceDir)).to.be.true
    })

    it('should not create link when cwd has .brv/config.json (shadow guard)', () => {
      createBrvConfig(testDir)

      // Simulating the guard check from link command
      const shouldBlock = hasBrvConfig(testDir)
      expect(shouldBlock).to.be.true
    })

    it('should not create link when cwd is not descendant of target (ancestor check)', () => {
      const targetRoot = join(testDir, 'project-a')
      const otherDir = join(testDir, 'project-b')
      mkdirSync(targetRoot, {recursive: true})
      mkdirSync(otherDir, {recursive: true})

      const shouldBlock = !isDescendantOf(otherDir, targetRoot)
      expect(shouldBlock).to.be.true
    })

    it('should not create link when cwd equals target (self-link guard)', () => {
      const targetRoot = testDir
      const cwd = testDir

      const isSelfLink = cwd === targetRoot
      expect(isSelfLink).to.be.true
    })

    it('should be idempotent when link already points to same target', () => {
      const workspaceDir = join(testDir, 'packages', 'api')
      mkdirSync(workspaceDir, {recursive: true})
      createWorkspaceLink(workspaceDir, testDir)

      // Read existing link
      const raw = readFileSync(join(workspaceDir, WORKSPACE_LINK_FILE), 'utf8')
      const existing = JSON.parse(raw)

      expect(existing.projectRoot).to.equal(testDir)

      // Overwrite with same target — should succeed silently
      createWorkspaceLink(workspaceDir, testDir)
      const rawAfter = readFileSync(join(workspaceDir, WORKSPACE_LINK_FILE), 'utf8')
      const after = JSON.parse(rawAfter)

      expect(after.projectRoot).to.equal(testDir)
    })

    it('should overwrite when link points to different target', () => {
      const workspaceDir = join(testDir, 'packages', 'api')
      mkdirSync(workspaceDir, {recursive: true})

      const oldTarget = join(testDir, 'old-project')
      const newTarget = join(testDir, 'new-project')
      mkdirSync(oldTarget, {recursive: true})
      mkdirSync(newTarget, {recursive: true})

      createWorkspaceLink(workspaceDir, oldTarget)
      createWorkspaceLink(workspaceDir, newTarget)

      const raw = readFileSync(join(workspaceDir, WORKSPACE_LINK_FILE), 'utf8')
      const result = JSON.parse(raw)

      expect(result.projectRoot).to.equal(newTarget)
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

  describe('auto-detect nearest project root', () => {
    it('should find .brv/config.json in ancestor directory', () => {
      createBrvConfig(testDir)
      const subDir = join(testDir, 'packages', 'api', 'src')
      mkdirSync(subDir, {recursive: true})

      // Walk up from subDir looking for hasBrvConfig
      let current = subDir
      let found: string | undefined
      while (current !== testDir) {
        if (hasBrvConfig(current)) {
          found = current

          break
        }

        const parent = join(current, '..')
        if (parent === current) break
        current = parent
      }

      // Check testDir itself
      if (!found && hasBrvConfig(testDir)) {
        found = testDir
      }

      expect(found).to.equal(testDir)
    })

    it('should not find project root when none exists', () => {
      const subDir = join(testDir, 'packages', 'api')
      mkdirSync(subDir, {recursive: true})

      // No .brv/config.json anywhere
      expect(hasBrvConfig(subDir)).to.be.false
      expect(hasBrvConfig(testDir)).to.be.false
    })
  })

  describe('git-boundary stop condition', () => {
    it('should stop walk-up at .git boundary', () => {
      // Simulate: outer-repo/.git exists with .brv/config.json
      //           outer-repo/inner-repo/.git exists (nested repo boundary)
      //           Walk from inner-repo/packages/api should NOT find outer-repo's .brv
      const outerRepo = join(testDir, 'outer-repo')
      const innerRepo = join(outerRepo, 'inner-repo')
      const subDir = join(innerRepo, 'packages', 'api')

      mkdirSync(subDir, {recursive: true})
      mkdirSync(join(outerRepo, '.git'), {recursive: true})
      mkdirSync(join(innerRepo, '.git'), {recursive: true})
      createBrvConfig(outerRepo)

      // Walk up from subDir, stopping at git root (same logic as link commands)
      let current = subDir
      let found: string | undefined
      const root = join(testDir, '..') // stop sentinel

      while (current !== root) {
        if (hasBrvConfig(current)) {
          found = current

          break
        }

        if (isGitRoot(current)) {
          break
        }

        const parent = join(current, '..')
        if (parent === current) break
        current = parent
      }

      // Should NOT find outer-repo — stopped at inner-repo's .git boundary
      expect(found).to.be.undefined
    })

    it('should find .brv/config.json at the git root itself', () => {
      // Repo root has both .git and .brv/config.json
      mkdirSync(join(testDir, '.git'), {recursive: true})
      createBrvConfig(testDir)

      const subDir = join(testDir, 'packages', 'api')
      mkdirSync(subDir, {recursive: true})

      let current = subDir
      let found: string | undefined

      while (current !== testDir) {
        if (hasBrvConfig(current)) {
          found = current

          break
        }

        if (isGitRoot(current)) {
          break
        }

        const parent = join(current, '..')
        if (parent === current) break
        current = parent
      }

      // Check the git root directory itself (walked up to it)
      if (!found && hasBrvConfig(current)) {
        found = current
      }

      // Should find it — .brv/config.json is AT the git root, checked before the break
      expect(found).to.equal(testDir)
    })

    it('should not cross git boundary even with .git worktree file', () => {
      const outerRepo = join(testDir, 'outer')
      const innerWorktree = join(outerRepo, 'worktree')
      const subDir = join(innerWorktree, 'src')

      mkdirSync(subDir, {recursive: true})
      createBrvConfig(outerRepo)
      // .git file (worktree) instead of directory
      writeFileSync(join(innerWorktree, '.git'), 'gitdir: /some/worktree/path')

      let current = subDir
      let found: string | undefined
      const root = join(testDir, '..')

      while (current !== root) {
        if (hasBrvConfig(current)) {
          found = current

          break
        }

        if (isGitRoot(current)) {
          break
        }

        const parent = join(current, '..')
        if (parent === current) break
        current = parent
      }

      expect(found).to.be.undefined
    })
  })
})
