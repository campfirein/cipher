/**
 * SessionReader Unit Tests
 *
 * Tests server-side adapter for reading session metadata.
 *
 * Key scenarios:
 * - Session listing from XDG sessions directory
 * - Empty sessions directory
 * - Error handling from SessionMetadataStore
 * - Options passed correctly to SessionMetadataStore
 */

import {expect} from 'chai'
import {mkdirSync, writeFileSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {SessionReader} from '../../../../src/server/infra/session/session-reader.js'

const PROJECT_PATH = '/Users/john/test-project'

function createSessionFile(sessionsDir: string, sessionId: string, index: number): void {
  mkdirSync(sessionsDir, {recursive: true})
  const filename = `session-2025-01-01T00-00-0${index}-${sessionId}.json`
  const metadata = {
    createdAt: `2025-01-01T00:00:0${index}.000Z`,
    lastUpdated: `2025-01-01T01:00:0${index}.000Z`,
    messageCount: 5 + index,
    sessionId: `agent-session-${sessionId}`,
    status: 'ended',
    title: `Test Session ${index}`,
    workingDirectory: PROJECT_PATH,
  }
  writeFileSync(join(sessionsDir, filename), JSON.stringify(metadata))
}

describe('SessionReader', () => {
  let tempDir: string
  let sessionsDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'brv-session-reader-test-'))
    sessionsDir = join(tempDir, 'sessions')
  })

  afterEach(async () => {
    await fs.rm(tempDir, {force: true, recursive: true})
  })

  describe('listSessions()', () => {
    it('should list sessions successfully from XDG storage path', async () => {
      // Create test session files
      createSessionFile(sessionsDir, 'uuid-1', 1)
      createSessionFile(sessionsDir, 'uuid-2', 2)
      createSessionFile(sessionsDir, 'uuid-3', 3)

      const reader = new SessionReader({
        sessionsDir,
        workingDirectory: PROJECT_PATH,
      })

      const result = await reader.listSessions()

      // Verify sessions returned (sorted by lastUpdated desc)
      expect(result).to.have.length(3)
      expect(result[0].sessionId).to.equal('agent-session-uuid-3')
      expect(result[1].sessionId).to.equal('agent-session-uuid-2')
      expect(result[2].sessionId).to.equal('agent-session-uuid-1')
    })

    it('should return empty array when no sessions exist', async () => {
      // Create empty sessions directory
      mkdirSync(sessionsDir, {recursive: true})

      const reader = new SessionReader({
        sessionsDir,
        workingDirectory: PROJECT_PATH,
      })

      const result = await reader.listSessions()

      expect(result).to.be.an('array')
      expect(result).to.have.length(0)
    })

    it('should return empty array when sessions directory does not exist', async () => {
      const nonExistentDir = join(tempDir, 'nonexistent', 'sessions')

      const reader = new SessionReader({
        sessionsDir: nonExistentDir,
        workingDirectory: PROJECT_PATH,
      })

      const result = await reader.listSessions()

      expect(result).to.be.an('array')
      expect(result).to.have.length(0)
    })

    it('should pass options correctly to SessionMetadataStore', async () => {
      createSessionFile(sessionsDir, 'uuid-1', 1)

      const reader = new SessionReader({
        sessionsDir,
        workingDirectory: PROJECT_PATH,
      })

      const result = await reader.listSessions()

      // Verify that SessionMetadataStore was initialized correctly
      // by checking that we get valid SessionInfo objects
      expect(result).to.have.length(1)
      expect(result[0]).to.have.property('sessionId')
      expect(result[0]).to.have.property('title')
      expect(result[0]).to.have.property('createdAt')
      expect(result[0]).to.have.property('lastUpdated')
      expect(result[0]).to.have.property('messageCount')
      expect(result[0]).to.have.property('workingDirectory')
      expect(result[0].workingDirectory).to.equal(PROJECT_PATH)
    })

    it('should handle sessions with different timestamps correctly', async () => {
      createSessionFile(sessionsDir, 'oldest', 1)
      createSessionFile(sessionsDir, 'middle', 5)
      createSessionFile(sessionsDir, 'newest', 9)

      const reader = new SessionReader({
        sessionsDir,
        workingDirectory: PROJECT_PATH,
      })

      const result = await reader.listSessions()

      // Sessions should be sorted by lastUpdated (newest first)
      expect(result).to.have.length(3)
      expect(result[0].sessionId).to.equal('agent-session-newest')
      expect(result[1].sessionId).to.equal('agent-session-middle')
      expect(result[2].sessionId).to.equal('agent-session-oldest')
    })

    it('should ignore invalid session files', async () => {
      mkdirSync(sessionsDir, {recursive: true})

      // Create valid session
      createSessionFile(sessionsDir, 'valid', 1)

      // Create invalid session files
      writeFileSync(join(sessionsDir, 'invalid.json'), 'not valid json')
      writeFileSync(join(sessionsDir, 'session-invalid.json'), JSON.stringify({incomplete: 'data'}))
      writeFileSync(join(sessionsDir, 'README.md'), 'Not a session file')

      const reader = new SessionReader({
        sessionsDir,
        workingDirectory: PROJECT_PATH,
      })

      const result = await reader.listSessions()

      // Should only return the valid session, ignoring invalid files
      expect(result).to.have.length(1)
      expect(result[0].sessionId).to.equal('agent-session-valid')
    })

    it('should handle sessions with missing optional fields', async () => {
      mkdirSync(sessionsDir, {recursive: true})

      // Create session with minimal required fields
      const minimalMetadata = {
        createdAt: '2025-01-01T00:00:00.000Z',
        lastUpdated: '2025-01-01T01:00:00.000Z',
        messageCount: 0,
        sessionId: 'agent-session-minimal',
        status: 'ended',
        workingDirectory: PROJECT_PATH,
      }
      writeFileSync(join(sessionsDir, 'session-2025-01-01T00-00-00-minimal.json'), JSON.stringify(minimalMetadata))

      const reader = new SessionReader({
        sessionsDir,
        workingDirectory: PROJECT_PATH,
      })

      const result = await reader.listSessions()

      expect(result).to.have.length(1)
      expect(result[0].sessionId).to.equal('agent-session-minimal')
      expect(result[0].title).to.be.undefined
    })
  })

  describe('constructor', () => {
    it('should create instance with valid options', () => {
      const reader = new SessionReader({
        sessionsDir,
        workingDirectory: PROJECT_PATH,
      })

      expect(reader).to.be.instanceOf(SessionReader)
    })

    it('should accept different session directory paths', () => {
      const customPath = join(tempDir, 'custom', 'sessions')

      const reader = new SessionReader({
        sessionsDir: customPath,
        workingDirectory: PROJECT_PATH,
      })

      expect(reader).to.be.instanceOf(SessionReader)
    })
  })
})
