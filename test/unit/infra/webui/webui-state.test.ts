import {expect} from 'chai'
import {existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readWebuiState, removeWebuiState, writeWebuiState} from '../../../../src/server/infra/webui/webui-state.js'

describe('webui-state', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-webui-state-test-')))
  })

  afterEach(() => {
    try {
      rmSync(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('writeWebuiState()', () => {
    it('should write port to webui.json', () => {
      writeWebuiState(7700, testDir)

      const state = readWebuiState(testDir)
      expect(state).to.deep.equal({port: 7700})
    })

    it('should overwrite existing state file', () => {
      writeWebuiState(7700, testDir)
      writeWebuiState(8800, testDir)

      const state = readWebuiState(testDir)
      expect(state).to.deep.equal({port: 8800})
    })
  })

  describe('readWebuiState()', () => {
    it('should return undefined when file does not exist', () => {
      const state = readWebuiState(testDir)
      expect(state).to.be.undefined
    })

    it('should return undefined for corrupted file', () => {
      writeFileSync(join(testDir, 'webui.json'), 'not json', 'utf8')

      const state = readWebuiState(testDir)
      expect(state).to.be.undefined
    })

    it('should return undefined for invalid structure', () => {
      writeFileSync(join(testDir, 'webui.json'), '{"wrong": true}', 'utf8')

      const state = readWebuiState(testDir)
      expect(state).to.be.undefined
    })

    it('should return undefined for non-number port', () => {
      writeFileSync(join(testDir, 'webui.json'), '{"port": "abc"}', 'utf8')

      const state = readWebuiState(testDir)
      expect(state).to.be.undefined
    })

    it('should read valid state file', () => {
      writeWebuiState(9999, testDir)

      const state = readWebuiState(testDir)
      expect(state).to.deep.equal({port: 9999})
    })
  })

  describe('removeWebuiState()', () => {
    it('should delete the state file', () => {
      writeWebuiState(7700, testDir)
      expect(existsSync(join(testDir, 'webui.json'))).to.be.true

      removeWebuiState(testDir)
      expect(existsSync(join(testDir, 'webui.json'))).to.be.false
    })

    it('should not throw when file does not exist', () => {
      expect(() => removeWebuiState(testDir)).to.not.throw()
    })
  })
})
