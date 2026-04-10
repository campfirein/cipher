/// <reference types="mocha" />

import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {WizardPrompts} from '../../../src/agent/infra/swarm/swarm-wizard.js'

import {SwarmLoader} from '../../../src/agent/infra/swarm/swarm-loader.js'
import SwarmOnboard from '../../../src/oclif/commands/swarm/onboard.js'

// ─── Testable subclass ───

class TestableSwarmOnboard extends SwarmOnboard {
  public writtenFiles: Record<string, string> = {}
  private mockConfirmLoadExisting?: boolean
  private mockLoader?: SwarmLoader
  private mockSwarmSpecExists?: boolean
  private mockWizardPrompts?: WizardPrompts

  protected override async confirmLoadExisting(): Promise<boolean> {
    if (this.mockConfirmLoadExisting !== undefined) return this.mockConfirmLoadExisting

    return super.confirmLoadExisting()
  }

  protected override createLoader(): SwarmLoader {
    return this.mockLoader ?? super.createLoader()
  }

  protected override createWizardPrompts(): WizardPrompts {
    return this.mockWizardPrompts ?? super.createWizardPrompts()
  }

  setMockConfirmLoadExisting(value: boolean): void {
    this.mockConfirmLoadExisting = value
  }

  setMockLoader(loader: SwarmLoader): void {
    this.mockLoader = loader
  }

  setMockSwarmSpecExists(value: boolean): void {
    this.mockSwarmSpecExists = value
  }

  setMockWizardPrompts(prompts: WizardPrompts): void {
    this.mockWizardPrompts = prompts
  }

  protected override async swarmSpecExists(...args: [string]): Promise<boolean> {
    if (this.mockSwarmSpecExists !== undefined) return this.mockSwarmSpecExists

    return super.swarmSpecExists(args[0])
  }

  protected override async writeFiles(_baseDir: string, files: Record<string, string>): Promise<void> {
    this.writtenFiles = files
  }
}

// ─── Mock wizard prompts that return a simple 1-agent swarm ───

function mockWizardPrompts(): WizardPrompts {
  const answers: Array<boolean | string | string[]> = [
    // Step 1: Identity
    'Test Swarm', 'test-swarm', 'Test description', 'Goal one',
    // Step 2: Agents (1 agent)
    'Agent', 'agent', 'Test agent', 'process',
    false, // don't add another
    // Step 3: Edges (single agent, no targets, checkbox not called)
    // Step 4: Output
    'agent',
  ]
  let idx = 0
  const next = () => answers[idx++]

  return {
    async checkbox() { return next() as string[] },
    async confirm() { return next() as boolean },
    async input(_msg: string, opts?: {default?: string}) {
      const val = next() as string
      return val === '' && opts?.default ? opts.default : val
    },
    async select() { return next() as string },
  }
}

function cancellingPrompts(): WizardPrompts {
  const err = new Error('CancelPromptError')
  err.name = 'CancelPromptError'
  return {
    async checkbox() { throw err },
    async confirm() { throw err },
    async input() { throw err },
    async select() { throw err },
  }
}

describe('SwarmOnboard Command', () => {
  let config: Config
  let loggedMessages: string[]

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  afterEach(() => {
    restore()
  })

  function createCommand(...argv: string[]): TestableSwarmOnboard {
    const command = new TestableSwarmOnboard(argv.length > 0 ? argv : ['.'], config)
    loggedMessages = []
    stub(command, 'log').callsFake((msg?: string) => {
      if (msg) loggedMessages.push(msg)
    })

    return command
  }

  describe('existing SWARM.md', () => {
    it('should delegate to swarm:load when user confirms', async () => {
      const command = createCommand('./my-swarm')
      command.setMockSwarmSpecExists(true)
      command.setMockConfirmLoadExisting(true)
      const runCommandStub = stub(command.config, 'runCommand').resolves()

      await command.run()

      expect(runCommandStub.calledOnce).to.be.true
      const [cmdName, cmdArgs] = runCommandStub.firstCall.args
      expect(cmdName).to.equal('swarm:load')
      expect(cmdArgs).to.be.an('array')
    })

    it('should exit without writing files when user declines', async () => {
      const command = createCommand('./my-swarm')
      command.setMockSwarmSpecExists(true)
      command.setMockConfirmLoadExisting(false)

      await command.run()

      expect(command.writtenFiles).to.deep.equal({})
      expect(loggedMessages.some((m) => m.includes('Aborted'))).to.be.true
    })
  })

  describe('wizard flow', () => {
    it('should write scaffolded files on successful wizard', async () => {
      const command = createCommand('./new-swarm')
      command.setMockSwarmSpecExists(false)
      command.setMockWizardPrompts(mockWizardPrompts())

      const mockLoader = new SwarmLoader()
      stub(mockLoader, 'load').resolves({
        agents: [],
        description: '',
        frontmatter: {} as never,
        runtimeConfig: {} as never,
        sourceDir: '/test',
        warnings: [],
      })
      command.setMockLoader(mockLoader)

      await command.run()

      expect(command.writtenFiles).to.have.property('SWARM.md')
      expect(command.writtenFiles).to.have.property('.swarm.yaml')
      expect(command.writtenFiles).to.have.property('agents/agent/AGENT.md')
      expect(loggedMessages.some((m) => m.includes('scaffolded successfully'))).to.be.true
    })

    it('should not write files when wizard is cancelled', async () => {
      const command = createCommand('./new-swarm')
      command.setMockSwarmSpecExists(false)
      command.setMockWizardPrompts(cancellingPrompts())

      await command.run()

      expect(command.writtenFiles).to.deep.equal({})
    })

    it('should exit 1 when final validation fails', async () => {
      const command = createCommand('./new-swarm')
      command.setMockSwarmSpecExists(false)
      command.setMockWizardPrompts(mockWizardPrompts())

      const mockLoader = new SwarmLoader()
      stub(mockLoader, 'load').rejects(new Error('Validation failed'))
      command.setMockLoader(mockLoader)

      const exitStub = stub(command, 'exit').callsFake((code?: number) => {
        throw Object.assign(new Error('EXIT'), {oclif: {exit: code ?? 0}})
      })

      try {
        await command.run()
        expect.fail('should have thrown')
      } catch {
        // exit(1) throws sentinel
      }

      expect(exitStub.calledOnceWithExactly(1)).to.be.true
      // Files were still written (left in place for debugging)
      expect(Object.keys(command.writtenFiles).length).to.be.greaterThan(0)
      expect(loggedMessages.some((m) => m.includes('Validation failed'))).to.be.true
    })
  })

  describe('args', () => {
    it('should default dir to current directory', async () => {
      const command = createCommand()
      command.setMockSwarmSpecExists(false)
      command.setMockWizardPrompts(cancellingPrompts())

      await command.run()

      // Command ran without error — dir defaulted to '.'
      expect(command.writtenFiles).to.deep.equal({})
    })
  })
})
