// import type {Config} from '@oclif/core'

// import {Config as OclifConfig} from '@oclif/core'
// import {expect} from 'chai'
// import sinon, {restore, stub} from 'sinon'

// import type {Agent} from '../../src/core/domain/entities/agent.js'
// import type {IFileService} from '../../src/core/interfaces/i-file-service.js'
// import type {IRuleTemplateService} from '../../src/core/interfaces/i-rule-template-service.js'
// import type {ITerminal} from '../../src/core/interfaces/i-terminal.js'
// import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'
// import type {IGenerateRulesUseCase} from '../../src/core/interfaces/usecase/i-generate-rules-use-case.js'

// import GenRules from '../../src/commands/gen-rules.js'
// import {LegacyRuleDetector} from '../../src/infra/rule/legacy-rule-detector.js'
// import {GenerateRulesUseCase} from '../../src/infra/usecase/generate-rules-use-case.js'
// import {createMockTerminal} from '../helpers/mock-factories.js'

// interface TestableUseCaseOptions {
//   fileService: IFileService
//   legacyRuleDetector: LegacyRuleDetector
//   mockFileCreationConfirmation: boolean
//   mockOverwriteConfirmation: boolean
//   mockSelectedAgent: Agent
//   templateService: IRuleTemplateService
//   terminal: ITerminal
//   trackingService: ITrackingService
// }

// /**
//  * Testable use case that allows overriding prompts
//  */
// class TestableGenerateRulesUseCase extends GenerateRulesUseCase {
//   private readonly mockFileCreationConfirmation: boolean
//   private readonly mockOverwriteConfirmation: boolean
//   private readonly mockSelectedAgent: Agent

//   constructor(options: TestableUseCaseOptions) {
//     super(
//       options.fileService,
//       options.legacyRuleDetector,
//       options.templateService,
//       options.terminal,
//       options.trackingService,
//     )
//     this.mockSelectedAgent = options.mockSelectedAgent
//     this.mockFileCreationConfirmation = options.mockFileCreationConfirmation
//     this.mockOverwriteConfirmation = options.mockOverwriteConfirmation
//   }

//   protected async promptForAgentSelection(): Promise<Agent> {
//     return this.mockSelectedAgent
//   }

//   protected async promptForFileCreation(_agent: Agent, _filePath: string): Promise<boolean> {
//     return this.mockFileCreationConfirmation
//   }

//   protected async promptForOverwriteConfirmation(_agent: Agent): Promise<boolean> {
//     return this.mockOverwriteConfirmation
//   }
// }

// /**
//  * Testable GenRules command that accepts a pre-configured use case
//  */
// class TestableGenRules extends GenRules {
//   constructor(
//     private readonly useCase: IGenerateRulesUseCase,
//     config: Config,
//   ) {
//     super([], config)
//   }

//   protected createUseCase(): IGenerateRulesUseCase {
//     return this.useCase
//   }
// }

// describe('GenRules Command', () => {
//   let config: Config
//   let fileService: sinon.SinonStubbedInstance<IFileService>
//   let legacyRuleDetector: LegacyRuleDetector
//   let templateService: sinon.SinonStubbedInstance<IRuleTemplateService>
//   let trackingService: sinon.SinonStubbedInstance<ITrackingService>

//   before(async () => {
//     config = await OclifConfig.load(import.meta.url)
//   })

//   beforeEach(() => {
//     fileService = {
//       createBackup: stub(),
//       exists: stub(),
//       read: stub(),
//       replaceContent: stub(),
//       write: stub(),
//     }
//     legacyRuleDetector = new LegacyRuleDetector()
//     stub(legacyRuleDetector, 'detectLegacyRules')
//     templateService = {
//       generateRuleContent: stub(),
//     }
//     trackingService = {
//       track: stub<Parameters<ITrackingService['track']>, ReturnType<ITrackingService['track']>>().resolves(),
//     }
//   })

//   afterEach(() => {
//     restore()
//   })

//   describe('run()', () => {
//     describe('Scenario A: File does not exist', () => {
//       it('should create new rule file when user confirms', async () => {
//         // Setup: file doesn't exist
//         fileService.exists.resolves(false)
//         templateService.generateRuleContent.resolves('# ByteRover Rules\n...')

//         const useCase = new TestableGenerateRulesUseCase({
//           fileService,
//           legacyRuleDetector,
//           mockFileCreationConfirmation: true, // User confirms creation
//           mockOverwriteConfirmation: false,
//           mockSelectedAgent: 'Claude Code',
//           templateService,
//           terminal: createMockTerminal(),
//           trackingService,
//         })
//         const command = new TestableGenRules(useCase, config)

//         await command.run()

//         expect(fileService.exists.calledOnce).to.be.true
//         expect(templateService.generateRuleContent.calledWith('Claude Code')).to.be.true
//         expect(fileService.write.calledOnce).to.be.true
//         expect(fileService.write.calledWith('# ByteRover Rules\n...', 'CLAUDE.md', 'overwrite')).to.be.true
//       })

//       it('should skip creation when user declines', async () => {
//         fileService.exists.resolves(false)

//         const useCase = new TestableGenerateRulesUseCase({
//           fileService,
//           legacyRuleDetector,
//           mockFileCreationConfirmation: false, // User declines creation
//           mockOverwriteConfirmation: false,
//           mockSelectedAgent: 'Cursor',
//           templateService,
//           terminal: createMockTerminal(),
//           trackingService,
//         })
//         const command = new TestableGenRules(useCase, config)

//         await command.run()

//         expect(fileService.exists.calledOnce).to.be.true
//         expect(templateService.generateRuleContent.called).to.be.false
//         expect(fileService.write.called).to.be.false
//       })
//     })

//     describe('Scenario B: File exists with NO ByteRover content', () => {
//       it('should append rules to existing file', async () => {
//         // Setup: file exists with no ByteRover content
//         fileService.exists.resolves(true)
//         fileService.read.resolves('# My Custom Instructions\n\nSome content')
//         templateService.generateRuleContent.resolves(
//           '\n<!-- BEGIN BYTEROVER RULES -->\n...\n<!-- END BYTEROVER RULES -->',
//         )

//         const useCase = new TestableGenerateRulesUseCase({
//           fileService,
//           legacyRuleDetector,
//           mockFileCreationConfirmation: false,
//           mockOverwriteConfirmation: false,
//           mockSelectedAgent: 'Claude Code',
//           templateService,
//           terminal: createMockTerminal(),
//           trackingService,
//         })
//         const command = new TestableGenRules(useCase, config)

//         await command.run()

//         expect(fileService.exists.calledOnce).to.be.true
//         expect(fileService.read.calledWith('CLAUDE.md')).to.be.true
//         expect(templateService.generateRuleContent.calledWith('Claude Code')).to.be.true
//         expect(
//           fileService.write.calledWith(
//             '\n<!-- BEGIN BYTEROVER RULES -->\n...\n<!-- END BYTEROVER RULES -->',
//             'CLAUDE.md',
//             'append',
//           ),
//         ).to.be.true
//       })
//     })

//     describe('Scenario C: File exists with NEW ByteRover rules (boundary markers)', () => {
//       it('should replace existing rules when user confirms overwrite', async () => {
//         const existingContent = [
//           '# My Instructions',
//           '<!-- BEGIN BYTEROVER RULES -->',
//           'Old rules here',
//           '<!-- END BYTEROVER RULES -->',
//           'More content',
//         ].join('\n')

//         fileService.exists.resolves(true)
//         fileService.read.resolves(existingContent)
//         templateService.generateRuleContent.resolves(
//           '<!-- BEGIN BYTEROVER RULES -->\nNew rules\n<!-- END BYTEROVER RULES -->',
//         )

//         const useCase = new TestableGenerateRulesUseCase({
//           fileService,
//           legacyRuleDetector,
//           mockFileCreationConfirmation: false,
//           mockOverwriteConfirmation: true, // User confirms overwrite
//           mockSelectedAgent: 'Claude Code',
//           templateService,
//           terminal: createMockTerminal(),
//           trackingService,
//         })
//         const command = new TestableGenRules(useCase, config)

//         await command.run()

//         expect(fileService.exists.calledOnce).to.be.true
//         expect(fileService.read.calledWith('CLAUDE.md')).to.be.true
//         expect(templateService.generateRuleContent.calledWith('Claude Code')).to.be.true
//         expect(fileService.write.calledOnce).to.be.true
//       })

//       it('should skip update when user declines overwrite', async () => {
//         const existingContent = '<!-- BEGIN BYTEROVER RULES -->\nRules\n<!-- END BYTEROVER RULES -->'

//         fileService.exists.resolves(true)
//         fileService.read.resolves(existingContent)

//         const useCase = new TestableGenerateRulesUseCase({
//           fileService,
//           legacyRuleDetector,
//           mockFileCreationConfirmation: false,
//           mockOverwriteConfirmation: false, // User declines overwrite
//           mockSelectedAgent: 'Cursor',
//           templateService,
//           terminal: createMockTerminal(),
//           trackingService,
//         })
//         const command = new TestableGenRules(useCase, config)

//         await command.run()

//         expect(fileService.exists.calledOnce).to.be.true
//         expect(fileService.read.calledOnce).to.be.true
//         expect(templateService.generateRuleContent.called).to.be.false
//         expect(fileService.write.called).to.be.false
//       })
//     })
//   })
// })
// eslint-disable-next-line unicorn/no-empty-file
