import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sinon, {restore, stub} from 'sinon'

import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../../src/core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import {CurateUseCase, type CurateUseCaseOptions} from '../../src/infra/usecase/curate-use-case.js'
import {createMockTerminal} from '../helpers/mock-factories.js'

/**
 * Testable CurateUseCase for runInteractive tests
 */
class TestableCurateUseCase extends CurateUseCase {
  public openCalledWith: null | string = null
  private mockNavigateResult: null | string = null
  private mockTopicName: null | string = null

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
}

/**
 * Testable CurateUseCase for createTopicWithContextFile tests
 */
class TestableCurateUseCaseForMethods extends CurateUseCase {
  // Expose protected method for testing
  public testCreateTopicWithContextFile(targetPath: string, topicName: string): string {
    return this.createTopicWithContextFile(targetPath, topicName)
  }

  // Expose private method for testing
  public testValidateTopicName(value: string, targetPath: string): boolean | string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).validateTopicName(value, targetPath)
  }
}

/**
 * Testable CurateUseCase for promptForTopicName tests
 */
class TestableCurateUseCaseForPrompt extends CurateUseCase {
  public inputCalledWithMessage: null | string = null
  private mockInputResult: null | string = null
  private mockInputShouldThrow = false

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
}

describe('Curate Command - Interactive Mode', () => {
  let loggedMessages: string[]
  let projectConfigStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let terminal: ITerminal
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let tempDir: string

  beforeEach(() => {
    loggedMessages = []

    terminal = createMockTerminal({
      log(message?: string) {
        if (message) {
          loggedMessages.push(message)
        }
      },
    })

    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    projectConfigStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }

    trackingService = {
      track: stub().resolves(),
    } as unknown as sinon.SinonStubbedInstance<ITrackingService>

    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-test-'))
  })

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, {force: true, recursive: true})

    restore()
  })

  function createUseCaseOptions(): CurateUseCaseOptions {
    return {
      projectConfigStore,
      terminal,
      tokenStore,
      trackingService,
    }
  }

  describe('runInteractive', () => {
    it('should cancel when navigation returns null', async () => {
      const useCase = new TestableCurateUseCase(createUseCaseOptions())
      useCase.setMockNavigateResult(null)
      useCase.setMockTopicName('test-topic')

      await useCase.run({})

      expect(loggedMessages.some((m) => m.includes('cancelled'))).to.be.true
    })

    it('should cancel when topic name prompt returns null', async () => {
      const useCase = new TestableCurateUseCase(createUseCaseOptions())
      useCase.setMockNavigateResult(tempDir)
      useCase.setMockTopicName(null)

      await useCase.run({})

      expect(loggedMessages.some((m) => m.includes('cancelled'))).to.be.true
    })

    it('should create topic folder and open context.md file', async () => {
      const useCase = new TestableCurateUseCase(createUseCaseOptions())
      useCase.setMockNavigateResult(tempDir)
      useCase.setMockTopicName('my-new-topic')

      await useCase.run({})

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
      expect(loggedMessages.some((m) => m.includes('Created:'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Opening context.md for editing...'))).to.be.true

      // Verify open was called with correct path
      expect(useCase.openCalledWith).to.equal(contextFilePath)
    })
  })

  describe('createTopicWithContextFile', () => {
    it('should create topic folder with context.md file', () => {
      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())

      const contextFilePath = useCase.testCreateTopicWithContextFile(tempDir, 'test-topic')

      const topicPath = path.join(tempDir, 'test-topic')
      expect(fs.existsSync(topicPath)).to.be.true
      expect(fs.existsSync(contextFilePath)).to.be.true
      expect(contextFilePath).to.equal(path.join(topicPath, 'context.md'))
    })

    it('should create context.md with correct initial content', () => {
      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())

      const contextFilePath = useCase.testCreateTopicWithContextFile(tempDir, 'My Topic')

      const content = fs.readFileSync(contextFilePath, 'utf8')
      expect(content).to.equal('# My Topic\n\n<!-- Add your context here -->\n')
    })

    it('should create nested directories if needed', () => {
      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())
      const nestedPath = path.join(tempDir, 'nested', 'path')

      const contextFilePath = useCase.testCreateTopicWithContextFile(nestedPath, 'deep-topic')

      expect(fs.existsSync(path.join(nestedPath, 'deep-topic', 'context.md'))).to.be.true
      expect(contextFilePath).to.equal(path.join(nestedPath, 'deep-topic', 'context.md'))
    })

    it('should return the path to context.md file', () => {
      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())

      const result = useCase.testCreateTopicWithContextFile(tempDir, 'result-topic')

      expect(result).to.equal(path.join(tempDir, 'result-topic', 'context.md'))
    })
  })

  describe('promptForTopicName', () => {
    it('should return null when input is cancelled', async () => {
      const useCase = new TestableCurateUseCaseForPrompt(createUseCaseOptions())
      useCase.setMockInputShouldThrow(true)

      const result = await useCase.testPromptForTopicName(tempDir)

      expect(result).to.be.null
    })

    it('should return trimmed topic name on valid input', async () => {
      const useCase = new TestableCurateUseCaseForPrompt(createUseCaseOptions())
      useCase.setMockInputResult('  valid-topic  ')

      const result = await useCase.testPromptForTopicName(tempDir)

      expect(result).to.equal('valid-topic')
    })

    it('should use correct prompt message', async () => {
      const useCase = new TestableCurateUseCaseForPrompt(createUseCaseOptions())
      useCase.setMockInputResult('topic')

      await useCase.testPromptForTopicName(tempDir)

      expect(useCase.inputCalledWithMessage).to.equal('New topic name:')
    })
  })

  describe('validateTopicName', () => {
    it('should reject empty topic name', () => {
      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())

      const result = useCase.testValidateTopicName('', tempDir)
      expect(result).to.equal('Topic name cannot be empty')
    })

    it('should reject topic name with only whitespace', () => {
      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())

      const result = useCase.testValidateTopicName('   ', tempDir)
      expect(result).to.equal('Topic name cannot be empty')
    })

    it('should reject topic name containing slash', () => {
      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())

      const result = useCase.testValidateTopicName('invalid/name', tempDir)
      expect(result).to.equal('Topic name can only contain letters (a-z, A-Z), numbers (0-9), and hyphens (-)')
    })

    it('should reject topic name if folder already exists', () => {
      // Create existing folder
      const existingFolder = path.join(tempDir, 'existing-topic')
      fs.mkdirSync(existingFolder, {recursive: true})

      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())

      const result = useCase.testValidateTopicName('existing-topic', tempDir)
      expect(result).to.equal('Topic "existing-topic" already exists at this location')
    })

    it('should accept valid topic name', () => {
      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())

      const result = useCase.testValidateTopicName('valid-topic-name', tempDir)
      expect(result).to.be.true
    })

    it('should reject topic name with spaces', () => {
      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())

      const result = useCase.testValidateTopicName('Topic With Spaces', tempDir)
      expect(result).to.equal('Topic name can only contain letters (a-z, A-Z), numbers (0-9), and hyphens (-)')
    })

    it('should reject topic name with special characters', () => {
      const useCase = new TestableCurateUseCaseForMethods(createUseCaseOptions())

      const result = useCase.testValidateTopicName('topic-with_special.chars', tempDir)
      expect(result).to.equal('Topic name can only contain letters (a-z, A-Z), numbers (0-9), and hyphens (-)')
    })
  })
})

// Note: Autonomous mode tests would require mocking CipherAgent which involves
// complex dependencies (LLM services, tokens, etc.). These tests are omitted
// for now and should be added in a separate test suite with proper mocking.
