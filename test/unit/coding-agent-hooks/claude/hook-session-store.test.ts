import {expect} from 'chai'
import {rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {HookSessionStore} from '../../../../src/coding-agent-hooks/claude/hook-session-store.js'

/**
 * Note: These tests use actual file operations since ES Modules cannot be stubbed.
 * Per CLAUDE.md: "ES modules cannot be stubbed with sinon. Test with real filesystem (tmpdir())"
 *
 * IMPORTANT: Tests use tmpdir for isolation - NEVER touch user directories.
 * This prevents tests from corrupting production session data.
 */
describe('coding-agent-hooks/claude/hook-session-store', () => {
  // Use tmpdir for test isolation - NEVER touch user directories like ~/.local/share/brv/
  const testDir = join(tmpdir(), 'brv-test-hook-sessions')
  const testSessionPrefix = 'test-hook-session-'

  // Helper to create store with test directory
  const createTestStore = () => new HookSessionStore(testDir)

  afterEach(async () => {
    // Clean up test directory only - safe because it's in tmpdir
    await rm(testDir, {force: true, recursive: true})
  })

  describe('write()', () => {
    it('should write a new session and read it back', async () => {
      const store = createTestStore()
      const sessionId = `${testSessionPrefix}write-1`
      const session = {
        sessionId,
        timestamp: Date.now(),
        transcriptPath: '~/.claude/projects/test.jsonl',
      }

      await store.write(session)

      const result = await store.read(sessionId)
      expect(result).to.deep.equal(session)
    })

    it('should overwrite existing session', async () => {
      const store = createTestStore()
      const sessionId = `${testSessionPrefix}overwrite-1`
      const session1 = {
        sessionId,
        timestamp: 1000,
        transcriptPath: '~/.claude/old.jsonl',
      }
      const session2 = {
        sessionId,
        timestamp: 2000,
        transcriptPath: '~/.claude/new.jsonl',
      }

      await store.write(session1)
      await store.write(session2)

      const result = await store.read(sessionId)
      expect(result?.transcriptPath).to.equal('~/.claude/new.jsonl')
      expect(result?.timestamp).to.equal(2000)
    })

    it('should preserve other sessions when writing', async () => {
      const store = createTestStore()
      const sessionId1 = `${testSessionPrefix}preserve-1`
      const sessionId2 = `${testSessionPrefix}preserve-2`
      const session1 = {
        sessionId: sessionId1,
        timestamp: Date.now(),
        transcriptPath: '~/.claude/1.jsonl',
      }
      const session2 = {
        sessionId: sessionId2,
        timestamp: Date.now(),
        transcriptPath: '~/.claude/2.jsonl',
      }

      await store.write(session1)
      await store.write(session2)

      const result1 = await store.read(sessionId1)
      const result2 = await store.read(sessionId2)
      expect(result1).to.exist
      expect(result2).to.exist
    })

    it('should handle session with all required fields', async () => {
      const store = createTestStore()
      const sessionId = `${testSessionPrefix}fields-1`
      const now = Date.now()
      const session = {
        sessionId,
        timestamp: now,
        transcriptPath: '~/.claude/projects/myproject/abc123.jsonl',
      }

      await store.write(session)

      const result = await store.read(sessionId)
      expect(result?.sessionId).to.equal(sessionId)
      expect(result?.transcriptPath).to.equal('~/.claude/projects/myproject/abc123.jsonl')
      expect(result?.timestamp).to.equal(now)
    })
  })

  describe('read()', () => {
    it('should return undefined for non-existent session', async () => {
      const store = createTestStore()

      const result = await store.read('does-not-exist-xyz-123')

      expect(result).to.be.undefined
    })

    it('should read session written in same test run', async () => {
      const store = createTestStore()
      const sessionId = `${testSessionPrefix}read-1`
      const session = {
        sessionId,
        timestamp: 12_345,
        transcriptPath: '~/.claude/read.jsonl',
      }
      await store.write(session)

      const result = await store.read(sessionId)

      expect(result).to.deep.equal(session)
    })

    it('should handle UUID-style session IDs', async () => {
      const store = createTestStore()
      const sessionId = `${testSessionPrefix}00893aaf-19fa-41d2-8238-13269b9b3ca0`
      const session = {
        sessionId,
        timestamp: Date.now(),
        transcriptPath: '~/.claude/uuid.jsonl',
      }
      await store.write(session)

      const result = await store.read(sessionId)

      expect(result?.sessionId).to.equal(sessionId)
    })
  })

  describe('cleanup()', () => {
    it('should remove sessions older than maxAge based on file modification time', async () => {
      const store = createTestStore()
      const oldSessionId = `${testSessionPrefix}cleanup-old`
      const newSessionId = `${testSessionPrefix}cleanup-new`
      const now = Date.now()

      // Write old session
      const oldSession = {
        sessionId: oldSessionId,
        timestamp: now,
        transcriptPath: '~/.claude/old.jsonl',
      }
      await store.write(oldSession)

      // Wait a bit to ensure time difference
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })

      // Write new session
      const newSession = {
        sessionId: newSessionId,
        timestamp: now,
        transcriptPath: '~/.claude/new.jsonl',
      }
      await store.write(newSession)

      // Cleanup with 50ms max age (old session should be removed)
      await store.cleanup(50)

      const oldResult = await store.read(oldSessionId)
      const newResult = await store.read(newSessionId)
      expect(oldResult).to.be.undefined
      expect(newResult).to.exist
    })

    it('should keep all sessions when none are old', async () => {
      const store = createTestStore()
      const sessionId = `${testSessionPrefix}cleanup-keep`
      const session = {
        sessionId,
        timestamp: Date.now(),
        transcriptPath: '~/.claude/recent.jsonl',
      }
      await store.write(session)

      await store.cleanup(86_400_000) // 24 hours

      const result = await store.read(sessionId)
      expect(result).to.exist
    })

    it('should not throw when called multiple times', async () => {
      const store = createTestStore()

      // Should complete without throwing
      await store.cleanup()
      await store.cleanup()
      await store.cleanup()
    })

    it('should handle cleanup with default maxAge', async () => {
      const store = createTestStore()
      const sessionId = `${testSessionPrefix}cleanup-default`
      const session = {
        sessionId,
        timestamp: Date.now(),
        transcriptPath: '~/.claude/default.jsonl',
      }
      await store.write(session)

      // Default is 24 hours, so recent session should survive
      await store.cleanup()

      const result = await store.read(sessionId)
      expect(result).to.exist
    })
  })

  describe('error handling', () => {
    it('should handle concurrent writes without throwing', async () => {
      const store = createTestStore()
      const now = Date.now()

      // Write multiple sessions concurrently
      const promises = []
      for (let i = 0; i < 5; i++) {
        const session = {
          sessionId: `${testSessionPrefix}concurrent-${i}`,
          timestamp: now,
          transcriptPath: `~/.claude/${i}.jsonl`,
        }
        promises.push(store.write(session))
      }

      // Should complete without throwing
      await Promise.all(promises)
    })

    it('should handle rapid sequential reads', async () => {
      const store = createTestStore()
      const sessionId = `${testSessionPrefix}rapid-read`
      const session = {
        sessionId,
        timestamp: Date.now(),
        transcriptPath: '~/.claude/rapid.jsonl',
      }
      await store.write(session)

      // Rapid sequential reads
      const readPromises = []
      for (let i = 0; i < 10; i++) {
        readPromises.push(store.read(sessionId))
      }

      const results = await Promise.all(readPromises)
      for (const result of results) {
        expect(result).to.exist
      }
    })

    it('should sanitize session ID with special characters', async () => {
      const store = createTestStore()
      const sessionIdWithSpecialChars = `${testSessionPrefix}../../../etc/passwd`
      const session = {
        sessionId: sessionIdWithSpecialChars,
        timestamp: Date.now(),
        transcriptPath: '~/.claude/safe.jsonl',
      }

      await store.write(session)

      const result = await store.read(sessionIdWithSpecialChars)
      expect(result).to.exist
      expect(result?.sessionId).to.equal(sessionIdWithSpecialChars)
    })

    it('should handle session isolation - different sessions in different files', async () => {
      const store = createTestStore()
      const sessionId1 = `${testSessionPrefix}isolation-1`
      const sessionId2 = `${testSessionPrefix}isolation-2`

      const session1 = {
        sessionId: sessionId1,
        timestamp: 1000,
        transcriptPath: '~/.claude/session1.jsonl',
      }
      const session2 = {
        sessionId: sessionId2,
        timestamp: 2000,
        transcriptPath: '~/.claude/session2.jsonl',
      }

      await store.write(session1)
      await store.write(session2)

      const result1 = await store.read(sessionId1)
      const result2 = await store.read(sessionId2)

      expect(result1?.sessionId).to.equal(sessionId1)
      expect(result2?.sessionId).to.equal(sessionId2)
      expect(result1?.timestamp).to.equal(1000)
      expect(result2?.timestamp).to.equal(2000)
    })
  })
})
