import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {Agent} from '../../src/core/domain/entities/agent.js'
import type {IRuleWriterService} from '../../src/core/interfaces/i-rule-writer-service.js'

import GenRules from '../../src/commands/gen-rules.js'
import {RuleExistsError} from '../../src/core/domain/errors/rule-error.js'

/**
 * Testable GenRules command that accepts mocked services
 */
class TestableGenRules extends GenRules {
  constructor(
    private readonly mockRuleWriterService: IRuleWriterService,
    private readonly mockSelectedAgent: Agent,
    private readonly mockOverwriteConfirmation: boolean,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    return {
      ruleWriterService: this.mockRuleWriterService,
    }
  }

  // Override the interactive search prompt
  protected async promptForAgentSelection(): Promise<Agent> {
    return this.mockSelectedAgent
  }

  // Override the interactive confirmation prompt
  protected async promptForOverwriteConfirmation(_agent: Agent): Promise<boolean> {
    return this.mockOverwriteConfirmation
  }
}

describe('GenRules Command', () => {
  let config: Config
  let ruleWriterService: sinon.SinonStubbedInstance<IRuleWriterService>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    ruleWriterService = {
      writeRule: stub(),
    }
  })

  afterEach(() => {
    restore()
  })

  describe('execute()', () => {
    it('should successfully generate rule file for Claude Code', async () => {
      ruleWriterService.writeRule.resolves()

      const command = new TestableGenRules(ruleWriterService, 'Claude Code', false, config)

      await command.run()

      expect(ruleWriterService.writeRule.calledOnce).to.be.true
      expect(ruleWriterService.writeRule.calledWith('Claude Code', false)).to.be.true
    })

    it('should successfully generate rule file for Cursor', async () => {
      ruleWriterService.writeRule.resolves()

      const command = new TestableGenRules(ruleWriterService, 'Cursor', false, config)

      await command.run()

      expect(ruleWriterService.writeRule.calledOnce).to.be.true
      expect(ruleWriterService.writeRule.calledWith('Cursor', false)).to.be.true
    })

    it('should successfully generate rule file for Windsurf', async () => {
      ruleWriterService.writeRule.resolves()

      const command = new TestableGenRules(ruleWriterService, 'Windsurf', false, config)

      await command.run()

      expect(ruleWriterService.writeRule.calledOnce).to.be.true
      expect(ruleWriterService.writeRule.calledWith('Windsurf', false)).to.be.true
    })

    it('should successfully generate rule file for Cline', async () => {
      ruleWriterService.writeRule.resolves()

      const command = new TestableGenRules(ruleWriterService, 'Cline', false, config)

      await command.run()

      expect(ruleWriterService.writeRule.calledOnce).to.be.true
      expect(ruleWriterService.writeRule.calledWith('Cline', false)).to.be.true
    })

    it('should prompt for overwrite confirmation when rule already exists', async () => {
      ruleWriterService.writeRule.onFirstCall().rejects(new RuleExistsError())
      ruleWriterService.writeRule.onSecondCall().resolves()

      const command = new TestableGenRules(
        ruleWriterService,
        'Claude Code',
        true, // User confirms overwrite
        config,
      )

      await command.run()

      expect(ruleWriterService.writeRule.calledTwice).to.be.true
      expect(ruleWriterService.writeRule.firstCall.calledWith('Claude Code', false)).to.be.true
      expect(ruleWriterService.writeRule.secondCall.calledWith('Claude Code', true)).to.be.true
    })

    it('should skip generation when user declines overwrite', async () => {
      ruleWriterService.writeRule.onFirstCall().rejects(new RuleExistsError())

      const command = new TestableGenRules(
        ruleWriterService,
        'Cursor',
        false, // User declines overwrite
        config,
      )

      await command.run()

      expect(ruleWriterService.writeRule.calledOnce).to.be.true
      expect(ruleWriterService.writeRule.calledWith('Cursor', false)).to.be.true
    })

    it('should handle RuleExistsError and retry with force=true when confirmed', async () => {
      const ruleExistsError = new RuleExistsError('Rule file already exists')
      ruleWriterService.writeRule.onFirstCall().rejects(ruleExistsError)
      ruleWriterService.writeRule.onSecondCall().resolves()

      const command = new TestableGenRules(ruleWriterService, 'Windsurf', true, config)

      await command.run()

      expect(ruleWriterService.writeRule.calledTwice).to.be.true
      expect(ruleWriterService.writeRule.firstCall.calledWith('Windsurf', false)).to.be.true
      expect(ruleWriterService.writeRule.secondCall.calledWith('Windsurf', true)).to.be.true
    })

    it('should throw error for non-recoverable errors', async () => {
      const genericError = new Error('File system error')
      ruleWriterService.writeRule.rejects(genericError)

      const command = new TestableGenRules(ruleWriterService, 'Claude Code', false, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('File system error')
      }
    })

    it('should throw error when rule writer service throws unknown error', async () => {
      ruleWriterService.writeRule.rejects(new Error('Unknown error'))

      const command = new TestableGenRules(ruleWriterService, 'Cursor', false, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Unknown error')
      }
    })

    it('should handle errors during retry after overwrite confirmation', async () => {
      ruleWriterService.writeRule.onFirstCall().rejects(new RuleExistsError())
      ruleWriterService.writeRule.onSecondCall().rejects(new Error('Write failed'))

      const command = new TestableGenRules(ruleWriterService, 'Cline', true, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Write failed')
      }
    })

    it('should work with all supported agents', async () => {
      const agents: Agent[] = [
        'Amp',
        'Augment Code',
        'Claude Code',
        'Cline',
        'Codex',
        'Cursor',
        'Gemini CLI',
        'Github Copilot',
        'Junie',
        'Kilo Code',
        'Kiro',
        'Qoder',
        'Qwen Code',
        'Roo Code',
        'Trae.ai',
        'Warp',
        'Windsurf',
        'Zed',
      ]

      for (const agent of agents) {
        ruleWriterService.writeRule.resolves()

        const command = new TestableGenRules(ruleWriterService, agent, false, config)

        // eslint-disable-next-line no-await-in-loop
        await command.run()

        expect(ruleWriterService.writeRule.calledWith(agent, false)).to.be.true
        ruleWriterService.writeRule.reset()
      }
    })
  })
})
