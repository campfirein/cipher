import type {EventEmitter} from 'node:events'
import type {SinonSandbox} from 'sinon'

import {expect} from 'chai'
import readline from 'node:readline'
import {setTimeout} from 'node:timers/promises'
import * as sinon from 'sinon'

import type {ICipherAgent} from '../../../src/agent/core/interfaces/i-cipher-agent.js'

import {displayInfo, startInteractiveLoop} from '../../../src/agent/infra/agent/interactive-loop.js'
import {AgentEventBus} from '../../../src/agent/infra/events/event-emitter.js'
import {createMockCipherAgent} from '../../helpers/mock-factories.js'

describe('interactive-loop', () => {
  let sandbox: SinonSandbox
  let consoleLogStub: sinon.SinonStub
  let stdoutWriteStub: sinon.SinonStub
  let mockAgent: ICipherAgent
  let mockReadline: readline.Interface
  let mockReadlineEmitter: EventEmitter
  let eventBus: AgentEventBus

  /**
   * Helper to filter out carriage return calls from stdout.write
   * Carriage returns (\r) are used for clearing terminal lines
   */
  const filterCarriageReturns = (calls: sinon.SinonSpyCall[]) =>
    calls.filter((call) => call.args[0] !== '\r' && !call.args[0].startsWith('\r '))

  /**
   * Helper to get combined stdout output (excluding carriage returns)
   */
  const getStdoutOutput = () =>
    filterCarriageReturns(stdoutWriteStub.getCalls())
      .map((call) => call.args[0])
      .join('')

  /**
   * Helper to get combined console.log output
   */
  const getConsoleLogOutput = () =>
    consoleLogStub
      .getCalls()
      .map((call) => call.args.join(' '))
      .join('\n')

  beforeEach(async () => {
    sandbox = sinon.createSandbox()

    // Create event bus for interactive loop
    eventBus = new AgentEventBus()

    // Suppress console output
    consoleLogStub = sandbox.stub(console, 'log')
    // Stub process.stdout.write for new displayInfo implementation
    stdoutWriteStub = sandbox.stub(process.stdout, 'write').returns(true)

    // Create mock readline interface
    const EventEmitterClass = (await import('node:events')).EventEmitter

    mockReadlineEmitter = new (class extends EventEmitterClass {
      close = sandbox.stub()
      // eslint-disable-next-line unicorn/consistent-function-scoping
      on = sandbox.stub().callsFake((event: string, handler: () => void) => {
        if (event === 'line' || event === 'SIGINT') {
          return super.on(event, handler)
        }

        return this
      })
      prompt = sandbox.stub()
      // eslint-disable-next-line unicorn/consistent-function-scoping
      removeListener = sandbox.stub().callsFake((event: string, handler: () => void) => {
        if (event === 'line' || event === 'SIGINT') {
          return super.removeListener(event, handler)
        }

        return this
      })
      setPrompt = sandbox.stub()
    })()

    mockReadline = mockReadlineEmitter as readline.Interface

    // Mock readline.createInterface
    sandbox.stub(readline, 'createInterface').returns(mockReadline)

    // Mock process.stdin.resume
    sandbox.stub(process.stdin, 'resume')

    // Mock process event handlers
    sandbox.stub(process, 'on')
    sandbox.stub(process, 'off')
    // Mock process.exit to prevent test from being killed
    sandbox.stub(process, 'exit')

    // Use factory function instead of `as ICipherAgent`
    mockAgent = createMockCipherAgent(sandbox)
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('displayInfo()', () => {
    it('should be exported and callable', () => {
      expect(displayInfo).to.be.a('function')
    })

    it('should write message to stdout with newline', () => {
      displayInfo('Test message')

      // Should write the message with newline
      const writeCalls = filterCarriageReturns(stdoutWriteStub.getCalls())
      expect(writeCalls.length).to.be.greaterThan(0)
      const output = getStdoutOutput()
      expect(output).to.include('Test message')
      expect(output).to.include('\n')
    })

    it('should handle empty message', () => {
      displayInfo('')

      // Should still call stdout.write (for clearing + writing)
      expect(stdoutWriteStub.called).to.be.true
    })

    it('should handle special characters', () => {
      displayInfo('Message with 🎉 emojis and <html>')

      const output = getStdoutOutput()
      expect(output).to.include('🎉')
      expect(output).to.include('<html>')
    })

    it('should write plain message without formatting when clear=false', () => {
      displayInfo('Info test')

      // Get all write calls excluding carriage returns
      const output = getStdoutOutput()
      // Should contain the message
      expect(output).to.include('Info test')
    })

    it('should handle long messages', () => {
      const longMessage = 'a'.repeat(500)
      displayInfo(longMessage)

      const output = getStdoutOutput()
      expect(output).to.include(longMessage)
    })

    it('should handle messages with newlines', () => {
      displayInfo('Line 1\nLine 2\nLine 3')

      const output = getStdoutOutput()
      expect(output).to.include('Line 1')
      expect(output).to.include('Line 2')
      expect(output).to.include('Line 3')
    })

    it('should handle messages with special characters', () => {
      displayInfo('Test with quotes "abc" and \'xyz\'')

      const output = getStdoutOutput()
      expect(output).to.include('quotes')
    })

    it('should be called multiple times independently', () => {
      displayInfo('First')
      displayInfo('Second')
      displayInfo('Third')

      // Filter out carriage return calls
      const writeCalls = filterCarriageReturns(stdoutWriteStub.getCalls())
      // Each displayInfo makes one write call (message + newline)
      expect(writeCalls.length).to.be.greaterThanOrEqual(3)

      const output = getStdoutOutput()
      expect(output).to.include('First')
      expect(output).to.include('Second')
      expect(output).to.include('Third')
    })

    it('should handle unicode characters', () => {
      displayInfo('Unicode test: 你好 مرحبا')

      const output = getStdoutOutput()
      expect(output).to.include('你好')
      expect(output).to.include('مرحبا')
    })

    it('should handle numbers and booleans when converted to strings', () => {
      displayInfo('Number: 42, Boolean: true')

      const output = getStdoutOutput()
      expect(output).to.include('42')
      expect(output).to.include('true')
    })

    it('should only clear line when clear=true', () => {
      stdoutWriteStub.resetHistory()
      displayInfo('Test', true)

      // When clear=true, should only write carriage returns (clearing), not the message
      const messageWrites = filterCarriageReturns(stdoutWriteStub.getCalls())
      // Should not write the actual message when clear=true
      expect(messageWrites.length).to.equal(0)
    })
  })

  describe('startInteractiveLoop()', () => {
    it('should be exported and callable', () => {
      expect(startInteractiveLoop).to.be.a('function')
    })

    it('should display welcome message with default values', async () => {
      const loopPromise = startInteractiveLoop(mockAgent, {eventBus})

      await setTimeout(1)

      // Emit banner event to trigger welcome message display (event listeners are now set up)
      eventBus.emit('cipher:ui', {
        context: {model: 'gemini-2.5-pro', sessionId: 'cipher-agent-session'},
        type: 'banner',
      })

      const lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
      if (lineHandler) {
        lineHandler('/exit')
      }

      await loopPromise

      // Verify welcome message was displayed
      const welcomeCalls = consoleLogStub.getCalls().filter((call) => {
        const message = call.args.join(' ')
        return message.includes('CipherAgent Interactive Mode')
      })
      expect(welcomeCalls.length).to.be.greaterThan(0)
    })

    it('should display welcome message with custom sessionId and model', async () => {
      const loopPromise = startInteractiveLoop(mockAgent, {
        eventBus,
        model: 'custom-model',
        sessionId: 'custom-session',
      })

      await setTimeout(1)

      // Emit banner event to trigger welcome message display with custom values
      eventBus.emit('cipher:ui', {
        context: {model: 'custom-model', sessionId: 'custom-session'},
        type: 'banner',
      })

      const lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
      if (lineHandler) {
        lineHandler('/exit')
      }

      await loopPromise

      const logOutput = getConsoleLogOutput()
      expect(logOutput).to.include('custom-model')
      expect(logOutput).to.include('custom-session')
    })

    it('should handle exit command and stop loop', async () => {
      const loopPromise = startInteractiveLoop(mockAgent)

      await setTimeout(1)
      const lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
      if (lineHandler) {
        lineHandler('/exit')
      }

      await loopPromise

      expect((mockReadline.close as sinon.SinonStub).called).to.be.true
    })

    it('should handle regular prompt and call agent.execute', async () => {
      ;(mockAgent.execute as sinon.SinonStub).resolves('AI response')

      const loopPromise = startInteractiveLoop(mockAgent)

      await setTimeout(1)
      let lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
      if (lineHandler) {
        lineHandler('user prompt')
        // Wait for handler to be removed and new one registered
        await setTimeout(1)
        // Get the new handler for exit command
        lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
        if (lineHandler) {
          lineHandler('/exit')
        }
      }

      await loopPromise

      expect((mockAgent.execute as sinon.SinonStub).calledWith('user prompt')).to.be.true
    })

    it('should handle empty input and skip', async () => {
      ;(mockAgent.execute as sinon.SinonStub).resolves('AI response')

      const loopPromise = startInteractiveLoop(mockAgent)

      await setTimeout(1)
      let lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
      if (lineHandler) {
        lineHandler('   ') // Whitespace only
        // Wait for handler to be removed and new one registered
        await setTimeout(1)
        // Get the new handler for exit command
        lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
        if (lineHandler) {
          lineHandler('/exit')
        }
      }

      await loopPromise

      expect((mockAgent.execute as sinon.SinonStub).called).to.be.false
    })

    it('should handle command with empty command name', async () => {
      const loopPromise = startInteractiveLoop(mockAgent, {eventBus})

      await setTimeout(1)
      let lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
      if (lineHandler) {
        lineHandler('/')
        // Wait for handler to be removed and new one registered
        await setTimeout(1)
        // Get the new handler for exit command
        lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
        if (lineHandler) {
          lineHandler('/exit')
        }
      }

      await loopPromise

      const helpMessageCalls = consoleLogStub.getCalls().filter((call) => {
        const message = call.args.join(' ')
        return message.includes('/help') || message.includes('Type /help')
      })
      expect(helpMessageCalls.length).to.be.greaterThan(0)
    })

    it('should handle agent.execute errors gracefully', async () => {
      const testError = new Error('Execution failed')
      ;(mockAgent.execute as sinon.SinonStub).rejects(testError)

      const loopPromise = startInteractiveLoop(mockAgent, {eventBus})

      await setTimeout(1)
      let lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
      if (lineHandler) {
        lineHandler('user prompt')
        // Wait for handler to be removed and new one registered
        await setTimeout(1)
        // Get the new handler for exit command
        lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
        if (lineHandler) {
          lineHandler('/exit')
        }
      }

      // Emit error event to simulate LLM service error handling
      eventBus.emit('llmservice:error', {error: 'Execution failed', sessionId: 'test-session'})

      await loopPromise

      // Errors are now written to stdout via event listener
      const output = getStdoutOutput()
      expect(output).to.include('Execution failed')
    })

    it('should cleanup on SIGINT', async () => {
      startInteractiveLoop(mockAgent)

      await setTimeout(1)

      // Emit SIGINT on readline to trigger cleanup
      mockReadlineEmitter.emit('SIGINT')

      // Wait a bit for cleanup to complete
      await setTimeout(1)

      expect((mockReadline.close as sinon.SinonStub).called).to.be.true
    })

    it('should cleanup on SIGTERM', async () => {
      startInteractiveLoop(mockAgent)

      await setTimeout(1)
      const exitEventHandler = process.on as sinon.SinonStub
      let sigtermHandler: (() => Promise<void>) | undefined

      const sigtermCall = exitEventHandler.getCalls().find((call) => call.args[0] === 'SIGTERM')
      if (sigtermCall) {
        sigtermHandler = sigtermCall.args[1] as () => Promise<void>
      }

      if (sigtermHandler) {
        await sigtermHandler()
      }

      // Wait a bit for cleanup to complete
      await setTimeout(1)

      expect((mockReadline.close as sinon.SinonStub).called).to.be.true
    })

    it('should cleanup resources in finally block', async () => {
      const loopPromise = startInteractiveLoop(mockAgent)

      await setTimeout(1)
      const lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
      if (lineHandler) {
        lineHandler('/exit')
      }

      await loopPromise

      expect((mockReadline.close as sinon.SinonStub).called).to.be.true
    })
  })
})
