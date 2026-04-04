import {expect} from 'chai'
import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {loadWorkspacesFile, writeWorkspacesFile} from '../../../../src/server/core/domain/knowledge/workspaces-schema.js'

describe('workspaces-schema', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `brv-ws-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(testDir, '.brv'), {recursive: true})
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('loadWorkspacesFile', () => {
    it('should return null when file does not exist', () => {
      const result = loadWorkspacesFile(testDir)
      expect(result).to.be.null
    })

    it('should return empty array for empty JSON array', () => {
      writeFileSync(join(testDir, '.brv', 'workspaces.json'), '[]')
      const result = loadWorkspacesFile(testDir)
      expect(result).to.deep.equal([])
    })

    it('should load valid workspaces', () => {
      const workspaces = ['../shared-lib', '../api-client', 'packages/*']
      writeFileSync(join(testDir, '.brv', 'workspaces.json'), JSON.stringify(workspaces))
      const result = loadWorkspacesFile(testDir)
      expect(result).to.deep.equal(workspaces)
    })

    it('should return empty array for malformed JSON', () => {
      writeFileSync(join(testDir, '.brv', 'workspaces.json'), 'not json')
      const result = loadWorkspacesFile(testDir)
      expect(result).to.deep.equal([])
    })

    it('should return empty array for invalid schema (object instead of array)', () => {
      writeFileSync(join(testDir, '.brv', 'workspaces.json'), '{"foo": "bar"}')
      const result = loadWorkspacesFile(testDir)
      expect(result).to.deep.equal([])
    })

    it('should return empty array for invalid schema (array of numbers)', () => {
      writeFileSync(join(testDir, '.brv', 'workspaces.json'), '[1, 2, 3]')
      const result = loadWorkspacesFile(testDir)
      expect(result).to.deep.equal([])
    })
  })

  describe('writeWorkspacesFile', () => {
    it('should write workspaces that can be loaded back', () => {
      const workspaces = ['../shared-lib', 'packages/*']
      writeWorkspacesFile(testDir, workspaces)
      const result = loadWorkspacesFile(testDir)
      expect(result).to.deep.equal(workspaces)
    })

    it('should write empty array', () => {
      writeWorkspacesFile(testDir, [])
      const result = loadWorkspacesFile(testDir)
      expect(result).to.deep.equal([])
    })

    it('should overwrite existing file', () => {
      writeWorkspacesFile(testDir, ['../old'])
      writeWorkspacesFile(testDir, ['../new'])
      const result = loadWorkspacesFile(testDir)
      expect(result).to.deep.equal(['../new'])
    })
  })
})
