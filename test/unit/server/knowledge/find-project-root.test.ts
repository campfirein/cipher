import {expect} from 'chai'
import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {findProjectRoot} from '../../../../src/server/core/domain/knowledge/find-project-root.js'

function createBrvProject(dir: string): void {
  mkdirSync(join(dir, '.brv'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({createdAt: new Date().toISOString(), version: '0.0.1'}))
}

describe('findProjectRoot', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `brv-find-root-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, {recursive: true})
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  it('should find .brv/ in current directory', () => {
    const projectRoot = join(testDir, 'project')
    createBrvProject(projectRoot)

    const result = findProjectRoot(projectRoot)
    expect(result).to.equal(projectRoot)
  })

  it('should walk up to find .brv/ in parent directory', () => {
    const projectRoot = join(testDir, 'project')
    const subfolder = join(projectRoot, 'subfolder1')
    createBrvProject(projectRoot)
    mkdirSync(subfolder, {recursive: true})

    const result = findProjectRoot(subfolder)
    expect(result).to.equal(projectRoot)
  })

  it('should walk up multiple levels', () => {
    const projectRoot = join(testDir, 'project')
    const deep = join(projectRoot, 'a', 'b', 'c')
    createBrvProject(projectRoot)
    mkdirSync(deep, {recursive: true})

    const result = findProjectRoot(deep)
    expect(result).to.equal(projectRoot)
  })

  it('should return undefined when no .brv/ found', () => {
    const noProject = join(testDir, 'no-project', 'sub')
    mkdirSync(noProject, {recursive: true})

    const result = findProjectRoot(noProject)
    expect(result).to.be.undefined
  })

  it('should stop at git root if provided', () => {
    // Simulate: git root has no .brv/, parent above does
    const above = join(testDir, 'above')
    const gitRoot = join(above, 'git-repo')
    const sub = join(gitRoot, 'sub')
    createBrvProject(above)
    mkdirSync(join(gitRoot, '.git'), {recursive: true})
    mkdirSync(sub, {recursive: true})

    // Without stopAt, it would find above/.brv
    // With stopAt=gitRoot, it should stop and return undefined
    const result = findProjectRoot(sub, {stopAtGitRoot: true})
    expect(result).to.be.undefined
  })

  it('should find .brv/ at git root itself', () => {
    const gitRoot = join(testDir, 'git-repo')
    const sub = join(gitRoot, 'sub')
    createBrvProject(gitRoot)
    mkdirSync(join(gitRoot, '.git'), {recursive: true})
    mkdirSync(sub, {recursive: true})

    const result = findProjectRoot(sub, {stopAtGitRoot: true})
    expect(result).to.equal(gitRoot)
  })

  it('should use nearest .brv/ when multiple exist', () => {
    const outer = join(testDir, 'outer')
    const inner = join(outer, 'inner')
    const sub = join(inner, 'sub')
    createBrvProject(outer)
    createBrvProject(inner)
    mkdirSync(sub, {recursive: true})

    const result = findProjectRoot(sub)
    expect(result).to.equal(inner)
  })
})
