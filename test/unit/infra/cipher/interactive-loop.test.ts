import type {EventEmitter} from 'node:events'
import type {SinonSandbox} from 'sinon'

import {expect} from 'chai'
import readline from 'node:readline'
import {setTimeout} from 'node:timers/promises'
import * as sinon from 'sinon'

import type {ICipherAgent} from '../../../../src/core/interfaces/cipher/i-cipher-agent.js'

import {displayInfo, startInteractiveLoop} from '../../../../src/infra/cipher/interactive-loop.js'

describe('interactive-loop', () => {
  let sandbox: SinonSandbox
  let consoleLogStub: sinon.SinonStub
  let consoleErrorStub: sinon.SinonStub
  let mockAgent: ICipherAgent
  let mockReadline: readline.Interface
  let mockReadlineEmitter: EventEmitter

  beforeEach(async () => {
    sandbox = sinon.createSandbox()

    // Suppress console output
    consoleLogStub = sandbox.stub(console, 'log')
    consoleErrorStub = sandbox.stub(console, 'error')

    // Create mock readline interface
    const EventEmitterClass = (await import('node:events')).EventEmitter

    mockReadlineEmitter = new (class extends EventEmitterClass {
      close = sandbox.stub()
      // eslint-disable-next-line unicorn/consistent-function-scoping
      on = sandbox.stub().callsFake((event: string, handler: () => void) => {
        if (event === 'line') {
          return super.on(event, handler)
        }

        return this
      })
      prompt = sandbox.stub()
      // eslint-disable-next-line unicorn/consistent-function-scoping
      removeListener = sandbox.stub().callsFake((event: string, handler: () => void) => {
        if (event === 'line') {
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

    // Create mock agent
    mockAgent = {
      deleteSession: sandbox.stub(),
      execute: sandbox.stub(),
      getSessionMetadata: sandbox.stub(),
      getState: sandbox.stub(),
      getSystemPrompt: sandbox.stub(),
      listPersistedSessions: sandbox.stub(),
      reset: sandbox.stub(),
      start: sandbox.stub(),
      stop: sandbox.stub().resolves(),
    } as ICipherAgent
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('displayInfo()', () => {
    it('should be exported and callable', () => {
      expect(displayInfo).to.be.a('function')
    })

    it('should call console.log with formatted message', () => {
      displayInfo('Test message')

      expect(consoleLogStub.calledOnce).to.be.true
      const message = consoleLogStub.firstCall.args[0]
      expect(message).to.include('Test message')
      expect(message).to.include('ℹ️')
    })

    it('should handle empty message', () => {
      displayInfo('')

      expect(consoleLogStub.calledOnce).to.be.true
    })

    it('should handle special characters', () => {
      displayInfo('Message with 🎉 emojis and <html>')

      expect(consoleLogStub.calledOnce).to.be.true
      const message = consoleLogStub.firstCall.args[0]
      expect(message).to.include('🎉')
      expect(message).to.include('<html>')
    })

    it('should format message with gray color and info icon', () => {
      displayInfo('Info test')

      expect(consoleLogStub.calledOnce).to.be.true
      const message = consoleLogStub.firstCall.args[0]
      // Chalk wraps text, so just verify core content
      expect(message).to.include('ℹ️  Info test')
    })

    it('should handle long messages', () => {
      const longMessage = 'a'.repeat(500)
      displayInfo(longMessage)

      expect(consoleLogStub.calledOnce).to.be.true
      const message = consoleLogStub.firstCall.args[0]
      expect(message).to.include(longMessage)
    })

    it('should handle messages with newlines', () => {
      displayInfo('Line 1\nLine 2\nLine 3')

      expect(consoleLogStub.calledOnce).to.be.true
      const message = consoleLogStub.firstCall.args[0]
      // Chalk color wrapping may modify newlines, just check content is present
      expect(message).to.include('Line 1')
      expect(message).to.include('Line 2')
      expect(message).to.include('Line 3')
    })

    it('should handle messages with special characters', () => {
      displayInfo('Test with quotes "abc" and \'xyz\'')

      expect(consoleLogStub.calledOnce).to.be.true
      const message = consoleLogStub.firstCall.args[0]
      expect(message).to.include('quotes')
    })

    it('should be called multiple times independently', () => {
      displayInfo('First')
      displayInfo('Second')
      displayInfo('Third')

      expect(consoleLogStub.callCount).to.equal(3)
      expect(consoleLogStub.firstCall.args[0]).to.include('First')
      expect(consoleLogStub.secondCall.args[0]).to.include('Second')
      expect(consoleLogStub.thirdCall.args[0]).to.include('Third')
    })

    it('should handle unicode characters', () => {
      displayInfo('Unicode test: 你好 مرحبا')

      expect(consoleLogStub.calledOnce).to.be.true
      const message = consoleLogStub.firstCall.args[0]
      expect(message).to.include('你好')
      expect(message).to.include('مرحبا')
    })

    it('should handle numbers and booleans when converted to strings', () => {
      displayInfo('Number: 42, Boolean: true')

      expect(consoleLogStub.calledOnce).to.be.true
      const message = consoleLogStub.firstCall.args[0]
      expect(message).to.include('42')
      expect(message).to.include('true')
    })
  })

  describe('startInteractiveLoop()', () => {
    it('should be exported and callable', () => {
      expect(startInteractiveLoop).to.be.a('function')
    })

    it('should display welcome message with default values', async () => {
      const loopPromise = startInteractiveLoop(mockAgent)

      await setTimeout(1)
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
        model: 'custom-model',
        sessionId: 'custom-session',
      })

      await setTimeout(1)
      const lineHandler = mockReadlineEmitter.listeners('line')[0] as ((line: string) => void) | undefined
      if (lineHandler) {
        lineHandler('/exit')
      }

      await loopPromise

      const logOutput = consoleLogStub.getCalls().map((call) => call.args.join(' ')).join('\n')
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
      expect((mockAgent.stop as sinon.SinonStub).called).to.be.true
    })

    it('should handle regular prompt and call agent.execute', async () => {
      ; (mockAgent.execute as sinon.SinonStub).resolves('AI response')

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
      ; (mockAgent.execute as sinon.SinonStub).resolves('AI response')

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
      const loopPromise = startInteractiveLoop(mockAgent)

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
        ; (mockAgent.execute as sinon.SinonStub).rejects(testError)

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

      expect(consoleErrorStub.called).to.be.true
      const errorMessage = consoleErrorStub.getCalls().map((call) => call.args.join(' ')).join('\n')
      expect(errorMessage).to.include('Execution failed')
    })

    it('should cleanup on SIGINT', async () => {
      startInteractiveLoop(mockAgent)

      await setTimeout(1)
      const exitEventHandler = process.on as sinon.SinonStub
      let sigintHandler: (() => Promise<void>) | undefined

      // Find SIGINT handler
      const sigintCall = exitEventHandler.getCalls().find((call) => call.args[0] === 'SIGINT')
      if (sigintCall) {
        sigintHandler = sigintCall.args[1] as () => Promise<void>
      }

      if (sigintHandler) {
        await sigintHandler()
      }

      // Wait a bit for cleanup to complete
      await setTimeout(1)

      expect((mockReadline.close as sinon.SinonStub).called).to.be.true
      expect((mockAgent.stop as sinon.SinonStub).called).to.be.true
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
      expect((mockAgent.stop as sinon.SinonStub).called).to.be.true
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
      expect((mockAgent.stop as sinon.SinonStub).called).to.be.true
    })
  })
})
