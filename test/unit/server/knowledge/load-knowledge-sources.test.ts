import {expect} from 'chai'
import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {loadKnowledgeSources} from '../../../../src/server/core/domain/knowledge/load-knowledge-sources.js'

function createBrvProject(dir: string): void {
  mkdirSync(join(dir, '.brv', 'context-tree'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({createdAt: new Date().toISOString(), version: '0.0.1'}))
}

describe('load-knowledge-sources', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `brv-load-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, {recursive: true})
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('loadKnowledgeSources', () => {
    it('should return null when workspaces.json does not exist', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)

      const result = loadKnowledgeSources(projectRoot)
      expect(result).to.be.null
    })

    it('should return empty sources for empty workspaces array', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)
      writeFileSync(join(projectRoot, '.brv', 'workspaces.json'), '[]')

      const result = loadKnowledgeSources(projectRoot)
      expect(result).to.not.be.null
      expect(result!.sources).to.deep.equal([])
      expect(result!.mtime).to.be.a('number')
    })

    it('should resolve workspaces into knowledge sources', () => {
      const projectRoot = join(testDir, 'project')
      const linkedLib = join(testDir, 'linked-lib')
      createBrvProject(projectRoot)
      createBrvProject(linkedLib)

      writeFileSync(join(projectRoot, '.brv', 'workspaces.json'), JSON.stringify(['../linked-lib']))

      const result = loadKnowledgeSources(projectRoot)
      expect(result).to.not.be.null
      expect(result!.sources).to.have.lengthOf(1)
      expect(result!.sources[0].type).to.equal('linked')
      expect(result!.sources[0].alias).to.equal('linked-lib')
      expect(result!.sources[0].contextTreeRoot).to.include('linked-lib')
    })

    it('should track mtime of workspaces.json', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)
      writeFileSync(join(projectRoot, '.brv', 'workspaces.json'), '[]')

      const result = loadKnowledgeSources(projectRoot)
      expect(result!.mtime).to.be.greaterThan(0)
    })

    it('should return empty sources for malformed workspaces.json', () => {
      const projectRoot = join(testDir, 'project')
      createBrvProject(projectRoot)
      writeFileSync(join(projectRoot, '.brv', 'workspaces.json'), 'not json')

      const result = loadKnowledgeSources(projectRoot)
      expect(result).to.not.be.null
      expect(result!.sources).to.deep.equal([])
    })

    it('should skip broken workspace paths', () => {
      const projectRoot = join(testDir, 'project')
      const validLib = join(testDir, 'valid-lib')
      createBrvProject(projectRoot)
      createBrvProject(validLib)

      writeFileSync(
        join(projectRoot, '.brv', 'workspaces.json'),
        JSON.stringify(['../nonexistent', '../valid-lib']),
      )

      const result = loadKnowledgeSources(projectRoot)
      expect(result!.sources).to.have.lengthOf(1)
      expect(result!.sources[0].alias).to.equal('valid-lib')
    })
  })
})
