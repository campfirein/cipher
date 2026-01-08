import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'

import HookPromptSubmit from '../../src/commands/hook-prompt-submit.js'

describe('commands/hook-prompt-submit', () => {
  let config: Config
  let loggedOutput: string[]

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    loggedOutput = []
  })

  /**
   * Create a testable command that captures log output
   */
  function createTestCommand(): HookPromptSubmit {
    const command = new HookPromptSubmit([], config)
    // Override log to capture output
    command.log = (msg?: string) => {
      if (msg) loggedOutput.push(msg)
    }

    return command
  }

  describe('output format', () => {
    it('should output ByteRover context header', async () => {
      const command = createTestCommand()
      await command.run()

      expect(loggedOutput.some((m) => m.includes('<!-- ByteRover Context -->'))).to.be.true
    })

    it('should include MANDATORY title', async () => {
      const command = createTestCommand()
      await command.run()

      expect(loggedOutput.some((m) => m.includes('# ByteRover Memory System - MANDATORY'))).to.be.true
    })

    it('should include BEGIN/END BYTEROVER RULES markers', async () => {
      const command = createTestCommand()
      await command.run()

      const output = loggedOutput.join('\n')
      expect(output).to.include('<!-- BEGIN BYTEROVER RULES -->')
      expect(output).to.include('<!-- END BYTEROVER RULES -->')
    })

    it('should include MUST language for enforcement', async () => {
      const command = createTestCommand()
      await command.run()

      const output = loggedOutput.join('\n')
      expect(output).to.include('You MUST run')
      expect(output).to.include('MUST NOT')
      expect(output).to.include('MANDATORY')
    })

    it('should include brv commands', async () => {
      const command = createTestCommand()
      await command.run()

      const output = loggedOutput.join('\n')
      expect(output).to.include('brv query')
      expect(output).to.include('brv curate')
    })

    it('should include workflow section', async () => {
      const command = createTestCommand()
      await command.run()

      const output = loggedOutput.join('\n')
      expect(output).to.include('WORKFLOW')
      expect(output).to.include('Code task received')
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
