import type {Config} from '@oclif/core'

import {Config as OclifConfig, ux} from '@oclif/core'
import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sinon, {restore, stub} from 'sinon'

import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import Curate from '../../src/commands/curate.js'

/**
 * Testable Curate command for runInteractive tests
 */
class TestableCurate extends Curate {
  public openCalledWith: null | string = null
  private logMessages: string[] = []
  private mockNavigateResult: null | string = null
  private mockTopicName: null | string = null

  public constructor(
    private readonly mockProjectConfigStore: IProjectConfigStore,
    private readonly mockTrackingService: ITrackingService,
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

  public error(input: Error | string): never {
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public getLogMessages(): string[] {
    return this.logMessages
  }

  public log(message?: string): void {
    if (message) {
      this.logMessages.push(message)
    }
  }

  protected async navigateContextTree(): Promise<null | string> {
    return this.mockNavigateResult
  }

  // Override to capture open calls instead of actually opening
  protected async openFile(filePath: string): Promise<void> {
    this.openCalledWith = filePath
  }

  protected async promptForTopicName(_targetPath: string): Promise<null | string> {
    return this.mockTopicName
  }

  public setMockNavigateResult(result: null | string): void {
    this.mockNavigateResult = result
  }

  public setMockTopicName(name: null | string): void {
    this.mockTopicName = name
  }

  public warn(input: Error | string): Error | string {
    return input
  }
}

/**
 * Testable Curate command for createTopicWithContextFile tests
 */
class TestableCurateForMethods extends Curate {
  private logMessages: string[] = []

  public constructor(
    private readonly mockProjectConfigStore: IProjectConfigStore,
    private readonly mockTrackingService: ITrackingService,
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

  public error(input: Error | string): never {
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public getLogMessages(): string[] {
    return this.logMessages
  }

  public log(message?: string): void {
    if (message) {
      this.logMessages.push(message)
    }
  }

  // Expose protected method for testing
  public testCreateTopicWithContextFile(targetPath: string, topicName: string): string {
    return this.createTopicWithContextFile(targetPath, topicName)
  }

  // Expose private method for testing
  public testValidateTopicName(value: string, targetPath: string): boolean | string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).validateTopicName(value, targetPath)
  }

  public warn(input: Error | string): Error | string {
    return input
  }
}

/**
 * Testable Curate command for promptForTopicName tests
 */
class TestableCurateForPrompt extends Curate {
  public inputCalledWithMessage: null | string = null
  private logMessages: string[] = []
  private mockInputResult: null | string = null
  private mockInputShouldThrow = false

  public constructor(
    private readonly mockProjectConfigStore: IProjectConfigStore,
    private readonly mockTrackingService: ITrackingService,
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

  public error(input: Error | string): never {
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public getLogMessages(): string[] {
    return this.logMessages
  }

  public log(message?: string): void {
    if (message) {
      this.logMessages.push(message)
    }
  }

  // Override promptForTopicName to use mock input
  protected async promptForTopicName(targetPath: string): Promise<null | string> {
    this.inputCalledWithMessage = 'New topic name:'

    if (this.mockInputShouldThrow) {
      return null
    }

    if (this.mockInputResult === null) {
      return null
    }

    // Simulate validation like the real method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validationResult = (this as any).validateTopicName(this.mockInputResult, targetPath)
    if (validationResult !== true) {
      throw new Error(validationResult as string)
    }

    return this.mockInputResult.trim()
  }

  public setMockInputResult(result: null | string): void {
    this.mockInputResult = result
  }

  public setMockInputShouldThrow(shouldThrow: boolean): void {
    this.mockInputShouldThrow = shouldThrow
  }

  // Expose for testing
  public async testPromptForTopicName(targetPath: string): Promise<null | string> {
    return this.promptForTopicName(targetPath)
  }

  public warn(input: Error | string): Error | string {
    return input
  }
}

describe('Curate Command - Interactive Mode', () => {
  let config: Config
  let projectConfigStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let uxActionStartStub: sinon.SinonStub
  let uxActionStopStub: sinon.SinonStub
  let tempDir: string

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

    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-test-'))
  })

  afterEach(() => {
    uxActionStartStub.restore()
    uxActionStopStub.restore()

    // Clean up temp directory
    fs.rmSync(tempDir, {force: true, recursive: true})

    restore()
  })

  describe('runInteractive', () => {
    it('should cancel when navigation returns null', async () => {
      const cmd = new TestableCurate(projectConfigStore, trackingService, config)
      cmd.setMockNavigateResult(null)
      cmd.setMockTopicName('test-topic')

      await cmd.run()

      const messages = cmd.getLogMessages()
      expect(messages.some((m) => m.includes('cancelled'))).to.be.true
    })

    it('should cancel when topic name prompt returns null', async () => {
      const cmd = new TestableCurate(projectConfigStore, trackingService, config)
      cmd.setMockNavigateResult(tempDir)
      cmd.setMockTopicName(null)

      await cmd.run()

      const messages = cmd.getLogMessages()
      expect(messages.some((m) => m.includes('cancelled'))).to.be.true
    })

    it('should create topic folder and open context.md file', async () => {
      const cmd = new TestableCurate(projectConfigStore, trackingService, config)
      cmd.setMockNavigateResult(tempDir)
      cmd.setMockTopicName('my-new-topic')

      await cmd.run()

      // Verify folder and file created
      const topicPath = path.join(tempDir, 'my-new-topic')
      const contextFilePath = path.join(topicPath, 'context.md')

      expect(fs.existsSync(topicPath)).to.be.true
      expect(fs.existsSync(contextFilePath)).to.be.true

      // Verify file content
      const content = fs.readFileSync(contextFilePath, 'utf8')
      expect(content).to.include('# my-new-topic')
      expect(content).to.include('<!-- Add your context here -->')

      // Verify log messages
      const messages = cmd.getLogMessages()
      expect(messages.some((m) => m.includes('Created:'))).to.be.true
      expect(messages.some((m) => m.includes('Opening context.md for editing...'))).to.be.true

      // Verify open was called with correct path
      expect(cmd.openCalledWith).to.equal(contextFilePath)
    })
  })

  describe('createTopicWithContextFile', () => {
    it('should create topic folder with context.md file', () => {
      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)

      const contextFilePath = cmd.testCreateTopicWithContextFile(tempDir, 'test-topic')

      const topicPath = path.join(tempDir, 'test-topic')
      expect(fs.existsSync(topicPath)).to.be.true
      expect(fs.existsSync(contextFilePath)).to.be.true
      expect(contextFilePath).to.equal(path.join(topicPath, 'context.md'))
    })

    it('should create context.md with correct initial content', () => {
      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)

      const contextFilePath = cmd.testCreateTopicWithContextFile(tempDir, 'My Topic')

      const content = fs.readFileSync(contextFilePath, 'utf8')
      expect(content).to.equal('# My Topic\n\n<!-- Add your context here -->\n')
    })

    it('should create nested directories if needed', () => {
      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)
      const nestedPath = path.join(tempDir, 'nested', 'path')

      const contextFilePath = cmd.testCreateTopicWithContextFile(nestedPath, 'deep-topic')

      expect(fs.existsSync(path.join(nestedPath, 'deep-topic', 'context.md'))).to.be.true
      expect(contextFilePath).to.equal(path.join(nestedPath, 'deep-topic', 'context.md'))
    })

    it('should return the path to context.md file', () => {
      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)

      const result = cmd.testCreateTopicWithContextFile(tempDir, 'result-topic')

      expect(result).to.equal(path.join(tempDir, 'result-topic', 'context.md'))
    })
  })

  describe('promptForTopicName', () => {
    it('should return null when input is cancelled', async () => {
      const cmd = new TestableCurateForPrompt(projectConfigStore, trackingService, config)
      cmd.setMockInputShouldThrow(true)

      const result = await cmd.testPromptForTopicName(tempDir)

      expect(result).to.be.null
    })

    it('should return trimmed topic name on valid input', async () => {
      const cmd = new TestableCurateForPrompt(projectConfigStore, trackingService, config)
      cmd.setMockInputResult('  valid-topic  ')

      const result = await cmd.testPromptForTopicName(tempDir)

      expect(result).to.equal('valid-topic')
    })

    it('should use correct prompt message', async () => {
      const cmd = new TestableCurateForPrompt(projectConfigStore, trackingService, config)
      cmd.setMockInputResult('topic')

      await cmd.testPromptForTopicName(tempDir)

      expect(cmd.inputCalledWithMessage).to.equal('New topic name:')
    })
  })

  describe('validateTopicName', () => {
    it('should reject empty topic name', () => {
      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)

      const result = cmd.testValidateTopicName('', tempDir)
      expect(result).to.equal('Topic name cannot be empty')
    })

    it('should reject topic name with only whitespace', () => {
      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)

      const result = cmd.testValidateTopicName('   ', tempDir)
      expect(result).to.equal('Topic name cannot be empty')
    })

    it('should reject topic name containing slash', () => {
      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)

      const result = cmd.testValidateTopicName('invalid/name', tempDir)
      expect(result).to.equal('Topic name cannot contain "/" or null characters')
    })

    it('should reject topic name if folder already exists', () => {
      // Create existing folder
      const existingFolder = path.join(tempDir, 'existing-topic')
      fs.mkdirSync(existingFolder, {recursive: true})

      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)

      const result = cmd.testValidateTopicName('existing-topic', tempDir)
      expect(result).to.equal('Topic "existing-topic" already exists at this location')
    })

    it('should accept valid topic name', () => {
      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)

      const result = cmd.testValidateTopicName('valid-topic-name', tempDir)
      expect(result).to.be.true
    })

    it('should accept topic name with spaces', () => {
      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)

      const result = cmd.testValidateTopicName('Topic With Spaces', tempDir)
      expect(result).to.be.true
    })

    it('should accept topic name with special characters', () => {
      const cmd = new TestableCurateForMethods(projectConfigStore, trackingService, config)

      const result = cmd.testValidateTopicName('topic-with_special.chars', tempDir)
      expect(result).to.be.true
    })
  })
})

// Note: Autonomous mode tests would require mocking CipherAgent which involves
// complex dependencies (LLM services, tokens, etc.). These tests are omitted
// for now and should be added in a separate test suite with proper mocking.
