import {expect} from 'chai'
import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {validateWriteTarget} from '../../../../src/agent/infra/tools/write-guard.js'

function createBrvProject(dir: string): void {
  mkdirSync(join(dir, '.brv', 'context-tree'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({createdAt: new Date().toISOString(), version: '0.0.1'}))
}

describe('write-guard', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `brv-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, {recursive: true})
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('validateWriteTarget', () => {
    it('should allow writes to local context tree', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)

      const target = join(projectRoot, '.brv', 'context-tree', 'some-file.md')
      const result = validateWriteTarget(target, projectRoot)
      expect(result).to.be.null
    })

    it('should allow writes to nested paths within local context tree', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)

      const target = join(projectRoot, '.brv', 'context-tree', 'sub', 'dir', 'file.md')
      const result = validateWriteTarget(target, projectRoot)
      expect(result).to.be.null
    })

    it('should block writes to a linked project context tree', () => {
      const projectRoot = join(testDir, 'project')
      const linkedProject = join(testDir, 'linked-lib')
      createBrvProject(projectRoot)
      createBrvProject(linkedProject)

      // Create workspaces.json linking to the other project
      writeFileSync(
        join(projectRoot, '.brv', 'workspaces.json'),
        JSON.stringify(['../linked-lib']),
      )

      const target = join(linkedProject, '.brv', 'context-tree', 'file.md')
      const result = validateWriteTarget(target, projectRoot)
      expect(result).to.be.a('string')
      expect(result).to.include('linked')
    })

    it('should block writes outside local context tree', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)

      const target = join(testDir, 'somewhere-else', 'file.md')
      const result = validateWriteTarget(target, projectRoot)
      expect(result).to.be.a('string')
    })

    it('should return null if projectRoot is not provided', () => {
      const result = validateWriteTarget('/some/path', '')
      expect(result).to.be.null
    })

    it('should block writes to .brv/ outside context-tree', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)

      const target = join(projectRoot, '.brv', 'config.json')
      const result = validateWriteTarget(target, projectRoot)
      expect(result).to.be.a('string')
    })
  })
})
