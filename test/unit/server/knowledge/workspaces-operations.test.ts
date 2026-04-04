import {expect} from 'chai'
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {addWorkspace, removeWorkspace} from '../../../../src/server/core/domain/knowledge/workspaces-operations.js'

function createBrvProject(dir: string): void {
  mkdirSync(join(dir, '.brv', 'context-tree'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({createdAt: new Date().toISOString(), version: '0.0.1'}))
}

describe('workspaces-operations', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `brv-ops-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, {recursive: true})
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('addWorkspace', () => {
    it('should add a valid workspace path', () => {
      const projectRoot = join(testDir, 'project')
      const target = join(testDir, 'target-lib')
      createBrvProject(projectRoot)
      createBrvProject(target)

      const result = addWorkspace(projectRoot, target)
      expect(result.success).to.be.true

      const saved = JSON.parse(readFileSync(join(projectRoot, '.brv', 'workspaces.json'), 'utf8'))
      expect(saved).to.be.an('array')
      expect(saved).to.have.lengthOf(1)
    })

    it('should store relative paths', () => {
      const projectRoot = join(testDir, 'project')
      const target = join(testDir, 'target-lib')
      createBrvProject(projectRoot)
      createBrvProject(target)

      addWorkspace(projectRoot, target)

      const saved = JSON.parse(readFileSync(join(projectRoot, '.brv', 'workspaces.json'), 'utf8'))
      expect(saved[0]).to.equal('../target-lib')
    })

    it('should fail for self-link', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)

      const result = addWorkspace(projectRoot, projectRoot)
      expect(result.success).to.be.false
      expect(result.message).to.include('self')
    })

    it('should fail for non-brv target', () => {
      const projectRoot = join(testDir, 'project')
      const target = join(testDir, 'not-brv')
      createBrvProject(projectRoot)
      mkdirSync(target, {recursive: true})

      const result = addWorkspace(projectRoot, target)
      expect(result.success).to.be.false
      expect(result.message).to.include('not a ByteRover project')
    })

    it('should fail for nonexistent target', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)

      const result = addWorkspace(projectRoot, join(testDir, 'nonexistent'))
      expect(result.success).to.be.false
    })

    it('should deduplicate existing entries', () => {
      const projectRoot = join(testDir, 'project')
      const target = join(testDir, 'target-lib')
      createBrvProject(projectRoot)
      createBrvProject(target)

      addWorkspace(projectRoot, target)
      const result = addWorkspace(projectRoot, target)
      expect(result.success).to.be.false
      expect(result.message).to.include('already')

      const saved = JSON.parse(readFileSync(join(projectRoot, '.brv', 'workspaces.json'), 'utf8'))
      expect(saved).to.have.lengthOf(1)
    })

    it('should append to existing workspaces', () => {
      const projectRoot = join(testDir, 'project')
      const target1 = join(testDir, 'lib1')
      const target2 = join(testDir, 'lib2')
      createBrvProject(projectRoot)
      createBrvProject(target1)
      createBrvProject(target2)

      addWorkspace(projectRoot, target1)
      addWorkspace(projectRoot, target2)

      const saved = JSON.parse(readFileSync(join(projectRoot, '.brv', 'workspaces.json'), 'utf8'))
      expect(saved).to.have.lengthOf(2)
    })
  })

  describe('removeWorkspace', () => {
    it('should remove an existing workspace by path', () => {
      const projectRoot = join(testDir, 'project')
      const target = join(testDir, 'target-lib')
      createBrvProject(projectRoot)
      createBrvProject(target)

      addWorkspace(projectRoot, target)
      const result = removeWorkspace(projectRoot, '../target-lib')
      expect(result.success).to.be.true

      const saved = JSON.parse(readFileSync(join(projectRoot, '.brv', 'workspaces.json'), 'utf8'))
      expect(saved).to.have.lengthOf(0)
    })

    it('should remove by absolute path', () => {
      const projectRoot = join(testDir, 'project')
      const target = join(testDir, 'target-lib')
      createBrvProject(projectRoot)
      createBrvProject(target)

      addWorkspace(projectRoot, target)
      const result = removeWorkspace(projectRoot, target)
      expect(result.success).to.be.true
    })

    it('should fail when workspace not found', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)
      writeFileSync(join(projectRoot, '.brv', 'workspaces.json'), '["../something"]')

      const result = removeWorkspace(projectRoot, '../nonexistent')
      expect(result.success).to.be.false
      expect(result.message).to.include('not found')
    })

    it('should fail when workspaces.json does not exist', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)

      const result = removeWorkspace(projectRoot, '../something')
      expect(result.success).to.be.false
    })
  })
})
