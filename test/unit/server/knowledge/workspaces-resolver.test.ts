import {expect} from 'chai'
import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {resolveWorkspaces} from '../../../../src/server/core/domain/knowledge/workspaces-resolver.js'

function createBrvProject(dir: string): void {
  mkdirSync(join(dir, '.brv', 'context-tree'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({createdAt: new Date().toISOString(), version: '0.0.1'}))
}

describe('workspaces-resolver', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `brv-resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, {recursive: true})
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('resolveWorkspaces', () => {
    it('should return empty array for empty workspaces list', () => {
      const result = resolveWorkspaces(testDir, [])
      expect(result).to.deep.equal([])
    })

    it('should resolve a valid relative path to a KnowledgeSource', () => {
      const projectRoot = join(testDir, 'main-project')
      const linkedProject = join(testDir, 'shared-lib')
      createBrvProject(projectRoot)
      createBrvProject(linkedProject)

      const result = resolveWorkspaces(projectRoot, ['../shared-lib'])
      expect(result).to.have.lengthOf(1)
      expect(result[0].type).to.equal('linked')
      expect(result[0].contextTreeRoot).to.include('shared-lib')
      expect(result[0].contextTreeRoot).to.include('context-tree')
      expect(result[0].sourceKey).to.match(/^[0-9a-f]{12}$/)
    })

    it('should skip paths that do not exist', () => {
      const projectRoot = join(testDir, 'main-project')
      createBrvProject(projectRoot)

      const result = resolveWorkspaces(projectRoot, ['../nonexistent'])
      expect(result).to.deep.equal([])
    })

    it('should skip paths without .brv/config.json', () => {
      const projectRoot = join(testDir, 'main-project')
      const noConfig = join(testDir, 'no-config')
      createBrvProject(projectRoot)
      mkdirSync(noConfig, {recursive: true})

      const result = resolveWorkspaces(projectRoot, ['../no-config'])
      expect(result).to.deep.equal([])
    })

    it('should skip paths without .brv/context-tree/', () => {
      const projectRoot = join(testDir, 'main-project')
      const noTree = join(testDir, 'no-tree')
      createBrvProject(projectRoot)
      mkdirSync(join(noTree, '.brv'), {recursive: true})
      writeFileSync(join(noTree, '.brv', 'config.json'), '{}')

      const result = resolveWorkspaces(projectRoot, ['../no-tree'])
      expect(result).to.deep.equal([])
    })

    it('should resolve multiple valid paths', () => {
      const projectRoot = join(testDir, 'main-project')
      const lib1 = join(testDir, 'lib1')
      const lib2 = join(testDir, 'lib2')
      createBrvProject(projectRoot)
      createBrvProject(lib1)
      createBrvProject(lib2)

      const result = resolveWorkspaces(projectRoot, ['../lib1', '../lib2'])
      expect(result).to.have.lengthOf(2)
      expect(result[0].sourceKey).to.not.equal(result[1].sourceKey)
    })

    it('should skip invalid paths and keep valid ones', () => {
      const projectRoot = join(testDir, 'main-project')
      const valid = join(testDir, 'valid')
      createBrvProject(projectRoot)
      createBrvProject(valid)

      const result = resolveWorkspaces(projectRoot, ['../nonexistent', '../valid'])
      expect(result).to.have.lengthOf(1)
      expect(result[0].contextTreeRoot).to.include('valid')
    })

    it('should resolve simple glob pattern (prefix/*)', () => {
      const projectRoot = join(testDir, 'main-project')
      createBrvProject(projectRoot)

      const packagesDir = join(testDir, 'main-project', 'packages')
      mkdirSync(packagesDir, {recursive: true})

      createBrvProject(join(packagesDir, 'pkg-a'))
      createBrvProject(join(packagesDir, 'pkg-b'))
      // non-brv dir should be skipped
      mkdirSync(join(packagesDir, 'not-brv'), {recursive: true})

      const result = resolveWorkspaces(projectRoot, ['packages/*'])
      expect(result).to.have.lengthOf(2)

      const aliases = result.map((s) => s.alias).sort()
      expect(aliases).to.deep.equal(['pkg-a', 'pkg-b'])
    })

    it('should use directory name as alias for relative paths', () => {
      const projectRoot = join(testDir, 'main-project')
      const linkedProject = join(testDir, 'my-shared-lib')
      createBrvProject(projectRoot)
      createBrvProject(linkedProject)

      const result = resolveWorkspaces(projectRoot, ['../my-shared-lib'])
      expect(result).to.have.lengthOf(1)
      expect(result[0].alias).to.equal('my-shared-lib')
    })

    it('should deduplicate paths that resolve to the same directory', () => {
      const projectRoot = join(testDir, 'main-project')
      const lib = join(testDir, 'lib')
      createBrvProject(projectRoot)
      createBrvProject(lib)

      const result = resolveWorkspaces(projectRoot, ['../lib', '../lib'])
      expect(result).to.have.lengthOf(1)
    })
  })
})
