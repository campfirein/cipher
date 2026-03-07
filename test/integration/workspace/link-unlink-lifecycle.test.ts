/**
 * Integration tests for workspace link lifecycle.
 *
 * Exercises the canonical resolver (`resolveProject`) across link/unlink
 * state transitions using real filesystem (tmpdir). No mocks.
 */

import {expect} from 'chai'
import {existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE, WORKSPACE_LINK_FILE} from '../../../src/server/constants.js'
import {
  BrokenWorkspaceLinkError,
  findNearestWorkspaceLink,
  MalformedWorkspaceLinkError,
  resolveProject,
} from '../../../src/server/infra/project/resolve-project.js'

function createBrvConfig(dir: string): void {
  const brvDir = join(dir, BRV_DIR)
  mkdirSync(brvDir, {recursive: true})
  writeFileSync(join(brvDir, PROJECT_CONFIG_FILE), JSON.stringify({version: '0.0.1'}))
}

function createWorkspaceLink(dir: string, projectRoot: string): void {
  writeFileSync(join(dir, WORKSPACE_LINK_FILE), JSON.stringify({projectRoot}, null, 2) + '\n')
}

function removeWorkspaceLink(dir: string): void {
  const linkFile = join(dir, WORKSPACE_LINK_FILE)
  if (existsSync(linkFile)) {
    unlinkSync(linkFile)
  }
}

describe('workspace link lifecycle (integration)', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-lifecycle-')))
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  it('should resolve through full link → resolve → unlink → resolve cycle', () => {
    // Setup: project root with .brv/config.json, workspace subdir
    const projectRoot = join(testDir, 'project')
    const workspace = join(projectRoot, 'packages', 'api')
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)

    // Before linking: workspace resolves as walked-up
    const before = resolveProject({cwd: workspace})
    expect(before).to.not.be.null
    expect(before!.source).to.equal('walked-up')
    expect(before!.projectRoot).to.equal(projectRoot)
    expect(before!.workspaceRoot).to.equal(projectRoot) // walked-up uses projectRoot as workspaceRoot

    // Create link
    createWorkspaceLink(workspace, projectRoot)

    // After linking: resolves as linked with correct workspaceRoot
    const linked = resolveProject({cwd: workspace})
    expect(linked).to.not.be.null
    expect(linked!.source).to.equal('linked')
    expect(linked!.projectRoot).to.equal(projectRoot)
    expect(linked!.workspaceRoot).to.equal(workspace)
    expect(linked!.linkFile).to.equal(join(workspace, WORKSPACE_LINK_FILE))

    // Remove link
    removeWorkspaceLink(workspace)

    // After unlinking: reverts to walked-up
    const afterUnlink = resolveProject({cwd: workspace})
    expect(afterUnlink).to.not.be.null
    expect(afterUnlink!.source).to.equal('walked-up')
    expect(afterUnlink!.projectRoot).to.equal(projectRoot)
    expect(afterUnlink!.workspaceRoot).to.equal(projectRoot)
  })

  it('should overwrite link target and resolve to new target', () => {
    const projectA = join(testDir, 'project-a')
    const projectB = join(testDir, 'project-b')
    const workspace = join(testDir, 'workspace')
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectA)
    createBrvConfig(projectB)

    // Link to project-a — but workspace must be descendant of target
    // Use project-a/sub as workspace so it's a valid descendant
    const workspaceInA = join(projectA, 'sub')
    mkdirSync(workspaceInA, {recursive: true})
    createWorkspaceLink(workspaceInA, projectA)

    const first = resolveProject({cwd: workspaceInA})
    expect(first!.projectRoot).to.equal(projectA)
    expect(first!.source).to.equal('linked')

    // Overwrite link to project-b — this time workspace must be in project-b
    const workspaceInB = join(projectB, 'sub')
    mkdirSync(workspaceInB, {recursive: true})
    createWorkspaceLink(workspaceInB, projectB)

    const second = resolveProject({cwd: workspaceInB})
    expect(second!.projectRoot).to.equal(projectB)
    expect(second!.source).to.equal('linked')
  })

  it('should detect shadow when cwd has both .brv/config.json and .brv-workspace.json', () => {
    const projectRoot = testDir
    createBrvConfig(projectRoot)
    createWorkspaceLink(projectRoot, '/some/other/project')

    const result = resolveProject({cwd: projectRoot})
    expect(result).to.not.be.null
    // Direct takes priority over linked
    expect(result!.source).to.equal('direct')
    expect(result!.projectRoot).to.equal(projectRoot)
    expect(result!.shadowedLink).to.be.true
  })

  it('should resolve nearest link when nested links exist', () => {
    // project/packages/api has a link, project/packages has a different link
    const projectRoot = join(testDir, 'project')
    const packages = join(projectRoot, 'packages')
    const api = join(packages, 'api')
    mkdirSync(api, {recursive: true})
    createBrvConfig(projectRoot)

    // Link at packages/ level
    createWorkspaceLink(packages, projectRoot)
    // Link at api/ level (nearest to cwd)
    createWorkspaceLink(api, projectRoot)

    const result = resolveProject({cwd: api})
    expect(result).to.not.be.null
    expect(result!.source).to.equal('linked')
    // Should resolve from api's link, not packages' link
    expect(result!.workspaceRoot).to.equal(api)
    expect(result!.linkFile).to.equal(join(api, WORKSPACE_LINK_FILE))
  })

  it('should find workspace link via findNearestWorkspaceLink after creation', () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(projectRoot, 'packages', 'api')
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)

    // Before: no link
    expect(findNearestWorkspaceLink(workspace)).to.be.null

    // Create link
    createWorkspaceLink(workspace, projectRoot)

    // After: found
    const linkFile = findNearestWorkspaceLink(workspace)
    expect(linkFile).to.equal(join(workspace, WORKSPACE_LINK_FILE))

    // From a subdirectory: walks up and finds it
    const subDir = join(workspace, 'src', 'controllers')
    mkdirSync(subDir, {recursive: true})
    const fromSub = findNearestWorkspaceLink(subDir)
    expect(fromSub).to.equal(join(workspace, WORKSPACE_LINK_FILE))
  })

  it('should throw BrokenWorkspaceLinkError when link target loses .brv/', () => {
    const projectRoot = join(testDir, 'project')
    const workspace = join(projectRoot, 'packages', 'api')
    mkdirSync(workspace, {recursive: true})
    createBrvConfig(projectRoot)
    createWorkspaceLink(workspace, projectRoot)

    // Verify it works first
    const valid = resolveProject({cwd: workspace})
    expect(valid!.source).to.equal('linked')

    // Remove .brv/config.json from project root
    rmSync(join(projectRoot, BRV_DIR), {force: true, recursive: true})

    // Now resolution should throw
    expect(() => resolveProject({cwd: workspace})).to.throw(BrokenWorkspaceLinkError)
  })

  it('should throw MalformedWorkspaceLinkError for invalid link file', () => {
    const workspace = join(testDir, 'workspace')
    mkdirSync(workspace, {recursive: true})

    // Write invalid JSON
    writeFileSync(join(workspace, WORKSPACE_LINK_FILE), 'not json at all')

    expect(() => resolveProject({cwd: workspace})).to.throw(MalformedWorkspaceLinkError)
  })

  it('should return null when no project exists anywhere', () => {
    const emptyDir = join(testDir, 'empty')
    mkdirSync(emptyDir, {recursive: true})

    const result = resolveProject({cwd: emptyDir})
    expect(result).to.be.null
  })
})
