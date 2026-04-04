import {expect} from 'chai'
import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {loadDependenciesFile, writeDependenciesFile} from '../../../../src/server/core/domain/knowledge/dependencies-schema.js'

describe('dependencies-schema', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `brv-deps-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(testDir, '.brv', 'context-tree'), {recursive: true})
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('loadDependenciesFile', () => {
    it('should return null when file does not exist', () => {
      const result = loadDependenciesFile(testDir)
      expect(result).to.be.null
    })

    it('should return empty object for empty JSON object', () => {
      writeFileSync(join(testDir, '.brv', 'context-tree', 'dependencies.json'), '{}')
      const result = loadDependenciesFile(testDir)
      expect(result).to.deep.equal({})
    })

    it('should load valid dependencies', () => {
      const deps = {'api-standards': '2.3', 'react-patterns': '1.0'}
      writeFileSync(join(testDir, '.brv', 'context-tree', 'dependencies.json'), JSON.stringify(deps))
      const result = loadDependenciesFile(testDir)
      expect(result).to.deep.equal(deps)
    })

    it('should return empty object for malformed JSON', () => {
      writeFileSync(join(testDir, '.brv', 'context-tree', 'dependencies.json'), 'not json')
      const result = loadDependenciesFile(testDir)
      expect(result).to.deep.equal({})
    })

    it('should return empty object for invalid schema (array instead of object)', () => {
      writeFileSync(join(testDir, '.brv', 'context-tree', 'dependencies.json'), '["foo"]')
      const result = loadDependenciesFile(testDir)
      expect(result).to.deep.equal({})
    })

    it('should return empty object for invalid schema (non-string values)', () => {
      writeFileSync(join(testDir, '.brv', 'context-tree', 'dependencies.json'), '{"foo": 123}')
      const result = loadDependenciesFile(testDir)
      expect(result).to.deep.equal({})
    })
  })

  describe('writeDependenciesFile', () => {
    it('should write dependencies that can be loaded back', () => {
      const deps = {'api-standards': '2.3', 'react-patterns': '1.0'}
      writeDependenciesFile(testDir, deps)
      const result = loadDependenciesFile(testDir)
      expect(result).to.deep.equal(deps)
    })

    it('should write empty object', () => {
      writeDependenciesFile(testDir, {})
      const result = loadDependenciesFile(testDir)
      expect(result).to.deep.equal({})
    })

    it('should overwrite existing file', () => {
      writeDependenciesFile(testDir, {'old': '1.0'})
      writeDependenciesFile(testDir, {'new': '2.0'})
      const result = loadDependenciesFile(testDir)
      expect(result).to.deep.equal({'new': '2.0'})
    })
  })
})
