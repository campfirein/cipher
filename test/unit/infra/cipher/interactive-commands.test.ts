import type {SinonSandbox} from 'sinon'

import {expect} from 'chai'
import * as sinon from 'sinon'

import type {ICipherAgent} from '../../../../src/core/interfaces/cipher/i-cipher-agent.js'

import {executeCommand} from '../../../../src/infra/cipher/interactive-commands.js'

describe('interactive-commands', () => {
  let sandbox: SinonSandbox
  let mockAgent: ICipherAgent
  let consoleLogStub: sinon.SinonStub
  let consoleErrorStub: sinon.SinonStub

  // Helper functions to reduce nested callbacks
  const findLogCall = (predicate: (message: string) => boolean) => {
    const calls = consoleLogStub.getCalls()
    for (const call of calls) {
      const message = call.args[0]?.toString() || ''
      if (predicate(message)) {
        return call
      }
    }
  }

  const getLogOutput = () => consoleLogStub.getCalls().map((call) => call.args.join(' '))

  const logOutputContains = (text: string) => getLogOutput().some((line) => line.includes(text))

  beforeEach(() => {
    sandbox = sinon.createSandbox()

    // Mock console to suppress output during tests
    consoleLogStub = sandbox.stub(console, 'log')
    consoleErrorStub = sandbox.stub(console, 'error')

    // Create mock ICipherAgent
    mockAgent = {
      deleteSession: sandbox.stub(),
      execute: sandbox.stub(),
      getSessionMetadata: sandbox.stub(),
      getState: sandbox.stub(),
      getSystemPrompt: sandbox.stub(),
      listPersistedSessions: sandbox.stub(),
      reset: sandbox.stub(),
      start: sandbox.stub(),
      stop: sandbox.stub(),
    } as unknown as ICipherAgent
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('command routing', () => {
    it('should find command by name', async () => {
      ; (mockAgent.getState as sinon.SinonStub).returns({
        currentIteration: 0,
        executionHistory: [],
      })

      const result = await executeCommand('status', [], mockAgent)

      expect(result).to.be.true
      expect(consoleLogStub.called).to.be.true
    })

    it('should find command by alias (? -> help)', async () => {
      const result = await executeCommand('?', [], mockAgent)

      expect(result).to.be.true
      expect(consoleLogStub.called).to.be.true
    })

    it('should find command by alias (quit -> exit)', async () => {
      const result = await executeCommand('quit', [], mockAgent)

      expect(result).to.be.false // exit returns false
      expect(consoleLogStub.called).to.be.true
    })

    it('should find command by alias (q -> exit)', async () => {
      const result = await executeCommand('q', [], mockAgent)

      expect(result).to.be.false
      expect(consoleLogStub.called).to.be.true
    })

    it('should handle unknown command', async () => {
      const result = await executeCommand('unknown', [], mockAgent)

      expect(result).to.be.true // Continue loop
      expect(consoleLogStub.called).to.be.true
      const errorCall = findLogCall((msg) => msg.includes('Unknown command'))
      expect(errorCall).to.exist
    })

    it('should be case sensitive', async () => {
      const result = await executeCommand('HELP', [], mockAgent)

      expect(result).to.be.true // Continue loop (unknown command)
      const errorCall = findLogCall((msg) => msg.includes('Unknown command'))
      expect(errorCall).to.exist
    })
  })

  describe('return values', () => {
    it('should return true for help command (continue loop)', async () => {
      const result = await executeCommand('help', [], mockAgent)

      expect(result).to.be.true
    })

    it('should return true for reset command (continue loop)', async () => {
      const result = await executeCommand('reset', [], mockAgent)

      expect(result).to.be.true
    })

    it('should return true for status command (continue loop)', async () => {
      ; (mockAgent.getState as sinon.SinonStub).returns({
        currentIteration: 0,
        executionHistory: [],
      })

      const result = await executeCommand('status', [], mockAgent)

      expect(result).to.be.true
    })

    it('should return true for sessions command (continue loop)', async () => {
      ; (mockAgent.listPersistedSessions as sinon.SinonStub).resolves([])

      const result = await executeCommand('sessions', [], mockAgent)

      expect(result).to.be.true
    })

    it('should return true for delete command (continue loop)', async () => {
      const result = await executeCommand('delete', [], mockAgent)

      expect(result).to.be.true // Missing arg, but continues
    })

    it('should return false for exit command (exit loop)', async () => {
      const result = await executeCommand('exit', [], mockAgent)

      expect(result).to.be.false
    })

    it('should return true on error (continue loop)', async () => {
      ; (mockAgent.getState as sinon.SinonStub).throws(new Error('Test error'))

      const result = await executeCommand('status', [], mockAgent)

      expect(result).to.be.true
      expect(consoleErrorStub.called).to.be.true
    })
  })

  describe('help command handler', () => {
    it('should list all available commands', async () => {
      const result = await executeCommand('help', [], mockAgent)

      expect(result).to.be.true

      expect(logOutputContains('/help')).to.be.true
      expect(logOutputContains('/reset')).to.be.true
      expect(logOutputContains('/status')).to.be.true
      expect(logOutputContains('/sessions')).to.be.true
      expect(logOutputContains('/delete')).to.be.true
      expect(logOutputContains('/exit')).to.be.true
    })

    it('should show command descriptions', async () => {
      await executeCommand('help', [], mockAgent)

      expect(logOutputContains('Show available commands')).to.be.true
      expect(logOutputContains('Clear conversation history')).to.be.true
    })

    it('should display aliases correctly', async () => {
      await executeCommand('help', [], mockAgent)

      expect(logOutputContains('?')).to.be.true // help alias
      expect(logOutputContains('quit')).to.be.true // exit alias
      expect(logOutputContains('q')).to.be.true // exit alias
    })

    it('should show usage information when available', async () => {
      await executeCommand('help', [], mockAgent)

      expect(logOutputContains('/delete <sessionId>')).to.be.true
    })
  })

  describe('reset command handler', () => {
    it('should call agent.reset()', async () => {
      await executeCommand('reset', [], mockAgent)

      expect((mockAgent.reset as sinon.SinonStub).calledOnce).to.be.true
    })

    it('should display success message', async () => {
      await executeCommand('reset', [], mockAgent)

      const successMsg = findLogCall((msg) => msg.includes('Conversation history cleared'))
      expect(successMsg).to.exist
    })

    it('should return true to continue loop', async () => {
      const result = await executeCommand('reset', [], mockAgent)

      expect(result).to.be.true
    })
  })

  describe('status command handler', () => {
    it('should call agent.getState()', async () => {
      ; (mockAgent.getState as sinon.SinonStub).returns({
        currentIteration: 5,
        executionHistory: ['exec1', 'exec2'],
      })

      await executeCommand('status', [], mockAgent)

      expect((mockAgent.getState as sinon.SinonStub).calledOnce).to.be.true
    })

    it('should display iteration count', async () => {
      ; (mockAgent.getState as sinon.SinonStub).returns({
        currentIteration: 42,
        executionHistory: [],
      })

      await executeCommand('status', [], mockAgent)

      expect(logOutputContains('42')).to.be.true
      expect(logOutputContains('Iterations')).to.be.true
    })

    it('should display execution history length', async () => {
      ; (mockAgent.getState as sinon.SinonStub).returns({
        currentIteration: 5,
        executionHistory: ['exec1', 'exec2', 'exec3'],
      })

      await executeCommand('status', [], mockAgent)

      expect(logOutputContains('3')).to.be.true
      expect(logOutputContains('history entries')).to.be.true
    })

    it('should show recent executions (last 3)', async () => {
      ; (mockAgent.getState as sinon.SinonStub).returns({
        currentIteration: 10,
        executionHistory: ['exec1', 'exec2', 'exec3', 'exec4', 'exec5'],
      })

      await executeCommand('status', [], mockAgent)

      expect(logOutputContains('exec3')).to.be.true
      expect(logOutputContains('exec4')).to.be.true
      expect(logOutputContains('exec5')).to.be.true
      expect(logOutputContains('exec1')).to.be.false
      expect(logOutputContains('exec2')).to.be.false
    })

    it('should handle empty execution history', async () => {
      ; (mockAgent.getState as sinon.SinonStub).returns({
        currentIteration: 0,
        executionHistory: [],
      })

      await executeCommand('status', [], mockAgent)

      expect(logOutputContains('0')).to.be.true
    })
  })

  describe('sessions command handler', () => {
    it('should call agent.listPersistedSessions()', async () => {
      ; (mockAgent.listPersistedSessions as sinon.SinonStub).resolves([])

      await executeCommand('sessions', [], mockAgent)

      expect((mockAgent.listPersistedSessions as sinon.SinonStub).calledOnce).to.be.true
    })

    it('should handle empty session list', async () => {
      ; (mockAgent.listPersistedSessions as sinon.SinonStub).resolves([])

      await executeCommand('sessions', [], mockAgent)

      expect(logOutputContains('No sessions found')).to.be.true
    })

    it('should load metadata for each session', async () => {
      ; (mockAgent.listPersistedSessions as sinon.SinonStub).resolves(['session-1', 'session-2'])
        ; (mockAgent.getSessionMetadata as sinon.SinonStub).resolves({
          lastActivity: Date.now(),
          messageCount: 5,
          sessionId: 'session-1',
        })

      await executeCommand('sessions', [], mockAgent)

      expect((mockAgent.getSessionMetadata as sinon.SinonStub).callCount).to.equal(2)
      expect((mockAgent.getSessionMetadata as sinon.SinonStub).firstCall.args[0]).to.equal(
        'session-1',
      )
      expect((mockAgent.getSessionMetadata as sinon.SinonStub).secondCall.args[0]).to.equal(
        'session-2',
      )
    })

    it('should sort sessions by last activity (most recent first)', async () => {
      const now = Date.now()
        ; (mockAgent.listPersistedSessions as sinon.SinonStub).resolves([
          'session-old',
          'session-new',
        ])

      const getMetadataStub = mockAgent.getSessionMetadata as sinon.SinonStub
      getMetadataStub.onFirstCall().resolves({
        lastActivity: now - 86_400_000, // 1 day ago
        messageCount: 5,
        sessionId: 'session-old',
      })
      getMetadataStub.onSecondCall().resolves({
        lastActivity: now - 3_600_000, // 1 hour ago
        messageCount: 10,
        sessionId: 'session-new',
      })

      await executeCommand('sessions', [], mockAgent)

      const logOutput = getLogOutput()
      const sessionOldIndex = logOutput.findIndex((line) => line.includes('session-old'))
      const sessionNewIndex = logOutput.findIndex((line) => line.includes('session-new'))

      // session-new should appear before session-old
      expect(sessionNewIndex).to.be.lessThan(sessionOldIndex)
    })

    it('should display session info (ID, message count, time)', async () => {
      ; (mockAgent.listPersistedSessions as sinon.SinonStub).resolves(['test-session'])
        ; (mockAgent.getSessionMetadata as sinon.SinonStub).resolves({
          lastActivity: Date.now() - 3_600_000, // 1 hour ago
          messageCount: 42,
          sessionId: 'test-session',
        })

      await executeCommand('sessions', [], mockAgent)

      expect(logOutputContains('test-session')).to.be.true
      expect(logOutputContains('42')).to.be.true
      expect(logOutputContains('messages')).to.be.true
    })

    it('should skip sessions with no metadata', async () => {
      ; (mockAgent.listPersistedSessions as sinon.SinonStub).resolves(['session-1', 'session-2'])

      const getMetadataStub = mockAgent.getSessionMetadata as sinon.SinonStub
      getMetadataStub.onFirstCall().resolves({
        lastActivity: Date.now(),
        messageCount: 5,
        sessionId: 'session-1',
      })
      getMetadataStub.onSecondCall().resolves()

      await executeCommand('sessions', [], mockAgent)

      expect(logOutputContains('session-1')).to.be.true
      expect(logOutputContains('session-2')).to.be.false
    })
  })

  describe('delete command handler', () => {
    it('should require session ID argument', async () => {
        const result = await executeCommand('delete', [], mockAgent)

        expect(result).to.be.true
        const errorMsg = findLogCall((msg) => msg.includes('Session ID is required'))
        expect(errorMsg).to.exist
      })

    it('should show usage when no argument provided', async () => {
        await executeCommand('delete', [], mockAgent)

        const usageMsg = findLogCall((msg) => msg.includes('/delete <sessionId>'))
        expect(usageMsg).to.exist
      })

    it('should check if session exists', async () => {
        ; (mockAgent.getSessionMetadata as sinon.SinonStub).resolves({
          lastActivity: Date.now(),
          messageCount: 5,
          sessionId: 'test-session',
        })
          ; (mockAgent.deleteSession as sinon.SinonStub).resolves(true)

        await executeCommand('delete', ['test-session'], mockAgent)

        expect((mockAgent.getSessionMetadata as sinon.SinonStub).calledOnce).to.be.true
        expect((mockAgent.getSessionMetadata as sinon.SinonStub).firstCall.args[0]).to.equal(
          'test-session',
        )
      })

    it('should handle non-existent session', async () => {
        ; (mockAgent.getSessionMetadata as sinon.SinonStub).resolves()

        const result = await executeCommand('delete', ['non-existent'], mockAgent)

        expect(result).to.be.true
        const errorMsg = findLogCall((msg) => msg.includes("Session 'non-existent' not found"))
        expect(errorMsg).to.exist
        expect((mockAgent.deleteSession as sinon.SinonStub).called).to.be.false
      })

    it('should call agent.deleteSession() for existing session', async () => {
        ; (mockAgent.getSessionMetadata as sinon.SinonStub).resolves({
          lastActivity: Date.now(),
          messageCount: 5,
          sessionId: 'test-session',
        })
          ; (mockAgent.deleteSession as sinon.SinonStub).resolves(true)

        await executeCommand('delete', ['test-session'], mockAgent)

        expect((mockAgent.deleteSession as sinon.SinonStub).calledOnce).to.be.true
        expect((mockAgent.deleteSession as sinon.SinonStub).firstCall.args[0]).to.equal(
          'test-session',
        )
      })

    it('should display success message when deleted', async () => {
        ; (mockAgent.getSessionMetadata as sinon.SinonStub).resolves({
          lastActivity: Date.now(),
          messageCount: 5,
          sessionId: 'test-session',
        })
          ; (mockAgent.deleteSession as sinon.SinonStub).resolves(true)

        await executeCommand('delete', ['test-session'], mockAgent)

        const successMsg = findLogCall((msg) => msg.includes('Deleted session: test-session'))
        expect(successMsg).to.exist
      })

    it('should display warning when session not in memory', async () => {
        ; (mockAgent.getSessionMetadata as sinon.SinonStub).resolves({
          lastActivity: Date.now(),
          messageCount: 5,
          sessionId: 'test-session',
        })
          ; (mockAgent.deleteSession as sinon.SinonStub).resolves(false)

        await executeCommand('delete', ['test-session'], mockAgent)

        const warningMsg = findLogCall((msg) => msg.includes("Session 'test-session' was not in memory"))
        expect(warningMsg).to.exist
    })
  })

  describe('exit command handler', () => {
    it('should return false to exit loop', async () => {
        const result = await executeCommand('exit', [], mockAgent)

        expect(result).to.be.false
      })

    it('should work with quit alias', async () => {
        const result = await executeCommand('quit', [], mockAgent)

        expect(result).to.be.false
      })

    it('should work with q alias', async () => {
        const result = await executeCommand('q', [], mockAgent)

        expect(result).to.be.false
      })

    it('should display goodbye message', async () => {
        await executeCommand('exit', [], mockAgent)

        const goodbyeMsg = findLogCall((msg) => msg.includes('Goodbye'))
        expect(goodbyeMsg).to.exist
    })
  })

  describe('error handling', () => {
    it('should catch handler errors', async () => {
        ; (mockAgent.getState as sinon.SinonStub).throws(new Error('Test error'))

        const result = await executeCommand('status', [], mockAgent)

        expect(result).to.be.true // Continue loop
        expect(consoleErrorStub.called).to.be.true
      })

    it('should display error messages', async () => {
        ; (mockAgent.getState as sinon.SinonStub).throws(new Error('Something went wrong'))

        await executeCommand('status', [], mockAgent)

        const errorOutput = consoleErrorStub.getCalls().map((call) => call.args.join(' '))
        const hasErrorMsg = errorOutput.some((line) => line.includes('Error executing command'))
        const hasErrorDetail = errorOutput.some((line) => line.includes('Something went wrong'))
        expect(hasErrorMsg).to.be.true
        expect(hasErrorDetail).to.be.true
      })

    it('should return true to continue loop on error', async () => {
        ; (mockAgent.listPersistedSessions as sinon.SinonStub).rejects(
          new Error('Database error'),
        )

        const result = await executeCommand('sessions', [], mockAgent)

        expect(result).to.be.true
      })

    it('should handle non-Error exceptions', async () => {
        ; (mockAgent.getState as sinon.SinonStub).throws('String error')

        const result = await executeCommand('status', [], mockAgent)

        expect(result).to.be.true
        expect(consoleErrorStub.called).to.be.true
    })
  })
})
