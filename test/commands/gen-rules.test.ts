import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {Agent} from '../../src/core/domain/entities/agent.js'
import type {IFileService} from '../../src/core/interfaces/i-file-service.js'
import type {IRuleTemplateService} from '../../src/core/interfaces/i-rule-template-service.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import GenRules from '../../src/commands/gen-rules.js'
import {LegacyRuleDetector} from '../../src/infra/rule/legacy-rule-detector.js'
import {createMockTerminal} from '../helpers/mock-factories.js'

/**
 * Testable GenRules command that accepts mocked services
 */
class TestableGenRules extends GenRules {
  // eslint-disable-next-line max-params
  constructor(
    private readonly mockFileService: IFileService,
    private readonly mockLegacyRuleDetector: LegacyRuleDetector,
    private readonly mockTemplateService: IRuleTemplateService,
    private readonly mockTrackingService: ITrackingService,
    private readonly mockSelectedAgent: Agent,
    private readonly mockFileCreationConfirmation: boolean,
    private readonly mockOverwriteConfirmation: boolean,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    this.terminal = createMockTerminal()
    return {
      fileService: this.mockFileService,
      legacyRuleDetector: this.mockLegacyRuleDetector,
      templateService: this.mockTemplateService,
      trackingService: this.mockTrackingService,
    }
  }

  // Override the interactive search prompt
  protected async promptForAgentSelection(): Promise<Agent> {
    return this.mockSelectedAgent
  }

  // Override the file creation prompt
  protected async promptForFileCreation(_agent: Agent, _filePath: string): Promise<boolean> {
    return this.mockFileCreationConfirmation
  }

  // Override the interactive confirmation prompt
  protected async promptForOverwriteConfirmation(_agent: Agent): Promise<boolean> {
    return this.mockOverwriteConfirmation
  }

  public warn(input: Error | string): Error | string {
    // Do nothing - suppress output, but return input to match base signature
    return input
  }
}

describe('GenRules Command', () => {
  let config: Config
  let fileService: sinon.SinonStubbedInstance<IFileService>
  let legacyRuleDetector: LegacyRuleDetector
  let templateService: sinon.SinonStubbedInstance<IRuleTemplateService>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    fileService = {
      createBackup: stub(),
      exists: stub(),
      read: stub(),
      replaceContent: stub(),
      write: stub(),
    }
    legacyRuleDetector = new LegacyRuleDetector()
    stub(legacyRuleDetector, 'detectLegacyRules')
    templateService = {
      generateRuleContent: stub(),
    }
    trackingService = {
      track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
    }
  })

  afterEach(() => {
    restore()
  })

  describe('run()', () => {
    describe('Scenario A: File does not exist', () => {
      it('should create new rule file when user confirms', async () => {
        // Setup: file doesn't exist
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('# ByteRover Rules\n...')

        const command = new TestableGenRules(
          fileService,
          legacyRuleDetector,
          templateService,
          trackingService,
          'Claude Code',
          true, // User confirms creation
          false,
          config,
        )

        await command.run()

        expect(fileService.exists.calledOnce).to.be.true
        expect(templateService.generateRuleContent.calledWith('Claude Code')).to.be.true
        expect(fileService.write.calledOnce).to.be.true
        expect(fileService.write.calledWith('# ByteRover Rules\n...', 'CLAUDE.md', 'overwrite')).to.be.true
      })

      it('should skip creation when user declines', async () => {
        fileService.exists.resolves(false)

        const command = new TestableGenRules(
          fileService,
          legacyRuleDetector,
          templateService,
          trackingService,
          'Cursor',
          false, // User declines creation
          false,
          config,
        )

        await command.run()

        expect(fileService.exists.calledOnce).to.be.true
        expect(templateService.generateRuleContent.called).to.be.false
        expect(fileService.write.called).to.be.false
      })
    })

    describe('Scenario B: File exists with NO ByteRover content', () => {
      it('should append rules to existing file', async () => {
        // Setup: file exists with no ByteRover content
        fileService.exists.resolves(true)
        fileService.read.resolves('# My Custom Instructions\n\nSome content')
        templateService.generateRuleContent.resolves(
          '\n<!-- BEGIN BYTEROVER RULES -->\n...\n<!-- END BYTEROVER RULES -->',
        )

        const command = new TestableGenRules(
          fileService,
          legacyRuleDetector,
          templateService,
          trackingService,
          'Claude Code',
          false,
          false,
          config,
        )

        await command.run()

        expect(fileService.exists.calledOnce).to.be.true
        expect(fileService.read.calledWith('CLAUDE.md')).to.be.true
        expect(templateService.generateRuleContent.calledWith('Claude Code')).to.be.true
        expect(
          fileService.write.calledWith(
            '\n<!-- BEGIN BYTEROVER RULES -->\n...\n<!-- END BYTEROVER RULES -->',
            'CLAUDE.md',
            'append',
          ),
        ).to.be.true
      })
    })

    describe('Scenario C: File exists with NEW ByteRover rules (boundary markers)', () => {
      it('should replace existing rules when user confirms overwrite', async () => {
        const existingContent = [
          '# My Instructions',
          '<!-- BEGIN BYTEROVER RULES -->',
          'Old rules here',
          '<!-- END BYTEROVER RULES -->',
          'More content',
        ].join('\n')

        fileService.exists.resolves(true)
        fileService.read.resolves(existingContent)
        templateService.generateRuleContent.resolves(
          '<!-- BEGIN BYTEROVER RULES -->\nNew rules\n<!-- END BYTEROVER RULES -->',
        )

        const command = new TestableGenRules(
          fileService,
          legacyRuleDetector,
          templateService,
          trackingService,
          'Claude Code',
          false,
          true, // User confirms overwrite
          config,
        )

        await command.run()

        expect(fileService.exists.calledOnce).to.be.true
        expect(fileService.read.calledWith('CLAUDE.md')).to.be.true
        expect(templateService.generateRuleContent.calledWith('Claude Code')).to.be.true
        expect(fileService.write.calledOnce).to.be.true
      })

      it('should skip update when user declines overwrite', async () => {
        const existingContent = '<!-- BEGIN BYTEROVER RULES -->\nRules\n<!-- END BYTEROVER RULES -->'

        fileService.exists.resolves(true)
        fileService.read.resolves(existingContent)

        const command = new TestableGenRules(
          fileService,
          legacyRuleDetector,
          templateService,
          trackingService,
          'Cursor',
          false,
          false, // User declines overwrite
          config,
        )

        await command.run()

        expect(fileService.exists.calledOnce).to.be.true
        expect(fileService.read.calledOnce).to.be.true
        expect(templateService.generateRuleContent.called).to.be.false
        expect(fileService.write.called).to.be.false
      })
    })
  })
})
