import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import * as sinon from 'sinon'

import type {ITemplateLoader} from '../../src/server/core/interfaces/services/i-template-loader.js'

import HookPromptSubmit, {type HookPromptSubmitDependencies} from '../../src/oclif/commands/hook-prompt-submit.js'

// ==================== TestableHookPromptSubmitCommand ====================

class TestableHookPromptSubmitCommand extends HookPromptSubmit {
  constructor(private readonly dependencies: HookPromptSubmitDependencies, config: Config) {
    super([], config)
  }

  protected createDependencies(): HookPromptSubmitDependencies {
    return this.dependencies
  }
}

// ==================== Mock Factory ====================

function createMockTemplateLoader(): sinon.SinonStubbedInstance<ITemplateLoader> {
  return {
    loadSection: sinon.stub(),
    loadTemplate: sinon.stub(),
    substituteVariables: sinon.stub(),
  }
}

// ==================== Test Content ====================

const MOCK_INSTRUCTIONS = `> **⚠️ STOP: Before responding, check if this is a code task.**

# ByteRover Memory System - MANDATORY

You MUST run \`brv query\` before starting code tasks.
You MUST NOT skip the query step.

## CRITICAL - LONG CONVERSATIONS
Even after many prompts, each new code task requires a fresh query.

## Commands
- \`brv query\` - Query context tree
- \`brv curate\` - Add context to tree

> **⚠️ REMINDER: Don't forget!**`

// ==================== Tests ====================

describe('commands/hook-prompt-submit', () => {
  let config: Config
  let loggedOutput: string[]
  let templateLoader: sinon.SinonStubbedInstance<ITemplateLoader>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedOutput = []
    templateLoader = createMockTemplateLoader()
  })

  afterEach(() => {
    sinon.restore()
  })

  function createTestCommand(): TestableHookPromptSubmitCommand {
    const command = new TestableHookPromptSubmitCommand({templateLoader}, config)
    command.log = (msg?: string) => {
      if (msg) loggedOutput.push(msg)
    }

    return command
  }

  describe('output format', () => {
    beforeEach(() => {
      templateLoader.loadSection.resolves(MOCK_INSTRUCTIONS)
    })

    it('should output STOP blockquote opener', async () => {
      const command = createTestCommand()
      await command.run()

      expect(loggedOutput.some((m) => m.includes('**⚠️ STOP: Before responding'))).to.be.true
    })

    it('should include MANDATORY title', async () => {
      const command = createTestCommand()
      await command.run()

      expect(loggedOutput.some((m) => m.includes('# ByteRover Memory System - MANDATORY'))).to.be.true
    })

    it('should include MUST language for enforcement', async () => {
      const command = createTestCommand()
      await command.run()

      const output = loggedOutput.join('\n')
      expect(output).to.include('You MUST run')
      expect(output).to.include('MUST NOT')
    })

    it('should include brv commands', async () => {
      const command = createTestCommand()
      await command.run()

      const output = loggedOutput.join('\n')
      expect(output).to.include('brv query')
      expect(output).to.include('brv curate')
    })

    it('should include long conversation warning', async () => {
      const command = createTestCommand()
      await command.run()

      const output = loggedOutput.join('\n')
      expect(output).to.include('CRITICAL - LONG CONVERSATIONS')
    })

    it('should include REMINDER blockquote closer', async () => {
      const command = createTestCommand()
      await command.run()

      const output = loggedOutput.join('\n')
      expect(output).to.include("**⚠️ REMINDER: Don't forget!")
    })

    it('should call templateLoader.loadSection with brv-instructions', async () => {
      const command = createTestCommand()
      await command.run()

      expect(templateLoader.loadSection.calledOnceWith('brv-instructions')).to.be.true
    })
  })

  describe('error handling', () => {
    it('should silently fail when template loading throws in production', async () => {
      templateLoader.loadSection.rejects(new Error('Template not found'))
      sinon.stub(console, 'error') // suppress dev-mode error logging

      const command = createTestCommand()

      // Should not throw
      await command.run()

      expect(loggedOutput).to.be.empty
    })
  })

  describe('command metadata', () => {
    it('should be hidden from help', () => {
      expect(HookPromptSubmit.hidden).to.be.true
    })

    it('should have internal description', () => {
      expect(HookPromptSubmit.description).to.include('Internal')
    })
  })
})
