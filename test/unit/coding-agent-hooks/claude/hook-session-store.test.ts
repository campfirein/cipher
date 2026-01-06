import {expect} from 'chai'

import {HookSessionStore} from '../../../../src/coding-agent-hooks/claude/hook-session-store.js'

/**
 * Note: These tests use actual file operations since ES Modules cannot be stubbed.
 * Per CLAUDE.md: "ES modules cannot be stubbed with sinon. Test with real filesystem (tmpdir())"
 *
 * The HookSessionStore uses getGlobalDataDir() which returns ~/.local/share/brv
 * Architecture: One file per session in ~/.local/share/brv/hook-sessions/
 * - Each session stored as {sessionId}.json
 * - Cleanup uses file modification time (not createdAt field)
 */
describe('coding-agent-hooks/claude/hook-session-store', () => {
  // We'll use the actual store which writes to ~/.local/share/brv/hook-sessions/{sessionId}.json
  // Tests should clean up after themselves
  const testSessionPrefix = 'test-hook-session-'

  afterEach(async () => {
    // Clean up all test sessions by removing with maxAge=0
    const store = new HookSessionStore()
    // Force cleanup of all sessions (maxAge = 0 means remove all)
    await store.cleanup(0)
  })

  describe('write()', () => {
    it('should write a new session and read it back', async () => {
      const store = new HookSessionStore()
      const sessionId = `${testSessionPrefix}write-1`
      const session = {
        createdAt: Date.now(),
        sessionId,
        timestamp: Date.now(),
        transcriptPath: '~/.claude/projects/test.jsonl',
      }

      await store.write(session)

      const result = await store.read(sessionId)
      expect(result).to.deep.equal(session)
    })

    it('should overwrite existing session', async () => {
      const store = new HookSessionStore()
      const sessionId = `${testSessionPrefix}overwrite-1`
      const session1 = {
        createdAt: 1000,
        sessionId,
        timestamp: 1000,
        transcriptPath: '~/.claude/old.jsonl',
      }
      const session2 = {
        createdAt: 2000,
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
      const store = new HookSessionStore()
      const sessionId1 = `${testSessionPrefix}preserve-1`
      const sessionId2 = `${testSessionPrefix}preserve-2`
      const session1 = {
        createdAt: Date.now(),
        sessionId: sessionId1,
        timestamp: Date.now(),
        transcriptPath: '~/.claude/1.jsonl',
      }
      const session2 = {
        createdAt: Date.now(),
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
      const store = new HookSessionStore()
      const sessionId = `${testSessionPrefix}fields-1`
      const now = Date.now()
      const session = {
        createdAt: now,
        sessionId,
        timestamp: now,
        transcriptPath: '~/.claude/projects/myproject/abc123.jsonl',
      }

      await store.write(session)

      const result = await store.read(sessionId)
      expect(result?.sessionId).to.equal(sessionId)
      expect(result?.transcriptPath).to.equal('~/.claude/projects/myproject/abc123.jsonl')
      expect(result?.timestamp).to.equal(now)
      expect(result?.createdAt).to.equal(now)
    })
  })

  describe('read()', () => {
    it('should return undefined for non-existent session', async () => {
      const store = new HookSessionStore()

      const result = await store.read('does-not-exist-xyz-123')

      expect(result).to.be.undefined
    })

    it('should read session written in same test run', async () => {
      const store = new HookSessionStore()
      const sessionId = `${testSessionPrefix}read-1`
      const session = {
        createdAt: 12_345,
        sessionId,
        timestamp: 12_345,
        transcriptPath: '~/.claude/read.jsonl',
      }
      await store.write(session)

      const result = await store.read(sessionId)

      expect(result).to.deep.equal(session)
    })

    it('should handle UUID-style session IDs', async () => {
      const store = new HookSessionStore()
      const sessionId = `${testSessionPrefix}00893aaf-19fa-41d2-8238-13269b9b3ca0`
      const session = {
        createdAt: Date.now(),
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
      const store = new HookSessionStore()
      const oldSessionId = `${testSessionPrefix}cleanup-old`
      const newSessionId = `${testSessionPrefix}cleanup-new`
      const now = Date.now()

      // Write old session
      const oldSession = {
        createdAt: now,
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
        createdAt: now,
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
      const store = new HookSessionStore()
      const sessionId = `${testSessionPrefix}cleanup-keep`
      const session = {
        createdAt: Date.now(),
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
      const store = new HookSessionStore()

      // Should complete without throwing
      await store.cleanup()
      await store.cleanup()
      await store.cleanup()
    })

    it('should handle cleanup with default maxAge', async () => {
      const store = new HookSessionStore()
      const sessionId = `${testSessionPrefix}cleanup-default`
      const session = {
        createdAt: Date.now(),
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
      const store = new HookSessionStore()
      const now = Date.now()

      // Write multiple sessions concurrently
      const promises = []
      for (let i = 0; i < 5; i++) {
        const session = {
          createdAt: now,
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
      const store = new HookSessionStore()
      const sessionId = `${testSessionPrefix}rapid-read`
      const session = {
        createdAt: Date.now(),
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
      const store = new HookSessionStore()
      const sessionIdWithSpecialChars = `${testSessionPrefix}../../../etc/passwd`
      const session = {
        createdAt: Date.now(),
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
      const store = new HookSessionStore()
      const sessionId1 = `${testSessionPrefix}isolation-1`
      const sessionId2 = `${testSessionPrefix}isolation-2`

      const session1 = {
        createdAt: 1000,
        sessionId: sessionId1,
        timestamp: 1000,
        transcriptPath: '~/.claude/session1.jsonl',
      }
      const session2 = {
        createdAt: 2000,
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
