import type {Config} from '@oclif/core'

import {Config as OclifConfig, ux} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import Add from '../../src/commands/add.js'

/**
 * Testable Add command that accepts mocked services and prompt responses
 */
class TestableAdd extends Add {
  private logMessages: string[] = []

  // eslint-disable-next-line max-params
  public constructor(
    private readonly mockContent: string,
    private readonly mockDomain: string,
    private readonly mockTopic: string,
    private readonly mockProjectConfigStore: IProjectConfigStore,
    private readonly mockTrackingService: ITrackingService,
    private readonly mockConfirmation: boolean,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    return {
      projectConfigStore: this.mockProjectConfigStore,
      trackingService: this.mockTrackingService,
    }
  }

  // Suppress all output to prevent noisy test runs
  public error(input: Error | string): never {
    // Throw error to maintain behavior but suppress output
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public getLogMessages(): string[] {
    return this.logMessages
  }

  public log(message?: string): void {
    // Capture log messages for verification
    if (message) {
      this.logMessages.push(message)
    }
  }

  // Override prompts
  protected async promptForConfirmation(_domain: string, _topic: string, _content: string): Promise<boolean> {
    return this.mockConfirmation
  }

  protected async promptForContent(_prefilled?: string): Promise<string> {
    return this.mockContent
  }

  protected async promptForDomain(_existingDomains: string[]): Promise<string> {
    return this.mockDomain
  }

  // Override file system operations
  protected getExistingDomains(): string[] {
    return ['code_style', 'design']
  }

  protected getExistingTopics(_domain: string): string[] {
    return ['formatting', 'naming']
  }

  protected async promptForTopic(_domain: string, _existingTopics: string[]): Promise<string> {
    return this.mockTopic
  }

  public warn(input: Error | string): Error | string {
    // Do nothing - suppress output, but return input to match base signature
    return input
  }
}

describe('Add Command - Interactive Mode', () => {
  let config: Config
  let projectConfigStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let uxActionStartStub: sinon.SinonStub
  let uxActionStopStub: sinon.SinonStub
  let writeToContextTreeStub: sinon.SinonStub

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    uxActionStartStub = stub(ux.action, 'start')
    uxActionStopStub = stub(ux.action, 'stop')

    projectConfigStore = {
      read: stub().resolves(),
      write: stub().resolves(),
    } as unknown as sinon.SinonStubbedInstance<IProjectConfigStore>

    trackingService = {
      track: stub().resolves(),
    } as unknown as sinon.SinonStubbedInstance<ITrackingService>
  })

  afterEach(() => {
    uxActionStartStub.restore()
    uxActionStopStub.restore()
    if (writeToContextTreeStub) {
      writeToContextTreeStub.restore()
    }

    restore()
  })

  describe('Interactive Mode', () => {
    it('should add content to context tree in interactive mode', async () => {
      const cmd = new TestableAdd(
        'Always validate user input', // content
        'code_style', // domain
        'best_practices', // topic
        projectConfigStore,
        trackingService,
        true, // confirmation
        config,
      )

      // Stub the writeToContextTree method
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeToContextTreeStub = stub(cmd as any, 'writeToContextTree').resolves()

      await cmd.run()

      expect(writeToContextTreeStub.calledOnce).to.be.true
      expect(
        writeToContextTreeStub.calledWith('code_style', 'best_practices', 'Always validate user input'),
      ).to.be.true

      expect(trackingService.track.calledOnce).to.be.true
      expect(trackingService.track.calledWith('ace:add_bullet')).to.be.true
    })

    it('should not add content when user declines confirmation', async () => {
      const cmd = new TestableAdd(
        'Some content',
        'design',
        'ui_patterns',
        projectConfigStore,
        trackingService,
        false, // user declines
        config,
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeToContextTreeStub = stub(cmd as any, 'writeToContextTree').resolves()

      await cmd.run()

      expect(writeToContextTreeStub.called).to.be.false
      expect(trackingService.track.called).to.be.false

      const messages = cmd.getLogMessages()
      expect(messages.some((m) => m.includes('cancel'))).to.be.true
    })

    it('should display welcome message with cancellation instructions', async () => {
      const cmd = new TestableAdd(
        'Test content',
        'code_style',
        'formatting',
        projectConfigStore,
        trackingService,
        true,
        config,
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeToContextTreeStub = stub(cmd as any, 'writeToContextTree').resolves()

      await cmd.run()

      const messages = cmd.getLogMessages()
      expect(messages.some((m) => m.includes('Ctrl+C'))).to.be.true
    })
  })

  describe('Validation', () => {
    it('should handle write errors gracefully', async () => {
      const cmd = new TestableAdd(
        'Test content',
        'code_style',
        'formatting',
        projectConfigStore,
        trackingService,
        true,
        config,
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeToContextTreeStub = stub(cmd as any, 'writeToContextTree').rejects(new Error('Write error'))

      try {
        await cmd.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.equal('Write error')
      }
    })
  })
})

// Note: Autonomous mode tests would require mocking CipherAgent which involves
// complex dependencies (LLM services, tokens, etc.). These tests are omitted
// for now and should be added in a separate test suite with proper mocking.
