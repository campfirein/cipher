import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import {Agent, AGENT_VALUES} from '../../../../src/core/domain/entities/agent.js'
import {RuleExistsError} from '../../../../src/core/domain/errors/rule-error.js'
import {IFileService} from '../../../../src/core/interfaces/i-file-service.js'
import {IRuleTemplateService} from '../../../../src/core/interfaces/i-rule-template-service.js'
import {BR_RULE_TAG} from '../../../../src/infra/rule/constants.js'
import {RuleWriterService} from '../../../../src/infra/rule/rule-writer-service.js'

describe('RuleWriterService', () => {
  let fileService: sinon.SinonStubbedInstance<IFileService>
  let service: RuleWriterService
  let templateService: sinon.SinonStubbedInstance<IRuleTemplateService>

  beforeEach(() => {
    fileService = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }

    templateService = {
      generateRuleContent: stub(),
    }

    service = new RuleWriterService(fileService, templateService)
  })

  afterEach(() => {
    restore()
  })

  describe('writeRule()', () => {
    describe('overwrite mode agents', () => {
      const overwriteAgents: Agent[] = [
        'Augment Code',
        'Cline',
        'Cursor',
        'Kilo Code',
        'Kiro',
        'Qoder',
        'Roo Code',
        'Windsurf',
        'Zed',
      ]

      for (const agent of overwriteAgents) {
        describe(agent, () => {
          // eslint-disable-next-line max-nested-callbacks
          it('should write rule when file does not exist', async () => {
            fileService.exists.resolves(false)
            templateService.generateRuleContent.resolves(`Mock rule content for ${agent}`)

            await service.writeRule(agent, false)

            expect(fileService.exists.calledOnce).to.be.true
            expect(templateService.generateRuleContent.calledWith(agent)).to.be.true
            expect(fileService.write.calledOnce).to.be.true

            const writeCall = fileService.write.getCall(0)
            expect(writeCall.args[0]).to.equal(`Mock rule content for ${agent}`)
            expect(writeCall.args[2]).to.equal('overwrite')
          })

          // eslint-disable-next-line max-nested-callbacks
          it('should throw RuleExistsError when file exists and force=false', async () => {
            fileService.exists.resolves(true)

            try {
              await service.writeRule(agent, false)
              expect.fail('Should have thrown RuleExistsError')
            } catch (error) {
              expect(error).to.be.instanceOf(RuleExistsError)
              expect(fileService.write.called).to.be.false
            }
          })

          // eslint-disable-next-line max-nested-callbacks
          it('should overwrite file when file exists and force=true', async () => {
            fileService.exists.resolves(true)
            templateService.generateRuleContent.resolves(`Mock rule content for ${agent}`)

            await service.writeRule(agent, true)

            expect(fileService.exists.calledOnce).to.be.true
            expect(templateService.generateRuleContent.calledWith(agent)).to.be.true
            expect(fileService.write.calledOnce).to.be.true

            const writeCall = fileService.write.getCall(0)
            expect(writeCall.args[0]).to.equal(`Mock rule content for ${agent}`)
            expect(writeCall.args[2]).to.equal('overwrite')
          })
        })
      }
    })

    describe('append mode agents', () => {
      const appendAgents: Agent[] = [
        'Amp',
        'Claude Code',
        'Codex',
        'Gemini CLI',
        'Github Copilot',
        'Junie',
        'Qwen Code',
        'Trae.ai',
        'Warp',
      ]

      for (const agent of appendAgents) {
        describe(agent, () => {
          // eslint-disable-next-line max-nested-callbacks
          it('should append rule when file does not exist', async () => {
            fileService.exists.resolves(false)
            templateService.generateRuleContent.resolves(`Mock rule content for ${agent}`)

            await service.writeRule(agent, false)

            expect(fileService.exists.calledOnce).to.be.true
            expect(templateService.generateRuleContent.calledWith(agent)).to.be.true
            expect(fileService.write.calledOnce).to.be.true

            const writeCall = fileService.write.getCall(0)
            expect(writeCall.args[0]).to.equal(`Mock rule content for ${agent}`)
            expect(writeCall.args[2]).to.equal('append')
          })

          // eslint-disable-next-line max-nested-callbacks
          it('should append when file exists but does not contain BR_RULE_TAG', async () => {
            fileService.exists.resolves(true)
            fileService.read.resolves('Existing content without tag')
            templateService.generateRuleContent.resolves(`Mock rule content for ${agent}`)

            await service.writeRule(agent, false)

            expect(fileService.exists.calledOnce).to.be.true
            expect(fileService.read.calledOnce).to.be.true
            expect(templateService.generateRuleContent.calledWith(agent)).to.be.true
            expect(fileService.write.calledOnce).to.be.true

            const writeCall = fileService.write.getCall(0)
            expect(writeCall.args[0]).to.equal(`Mock rule content for ${agent}`)
            expect(writeCall.args[2]).to.equal('append')
          })

          // eslint-disable-next-line max-nested-callbacks
          it('should throw RuleExistsError when file exists with BR_RULE_TAG and force=false', async () => {
            fileService.exists.resolves(true)
            fileService.read.resolves(`Existing content\n${BR_RULE_TAG}\nMore content`)

            try {
              await service.writeRule(agent, false)
              expect.fail('Should have thrown RuleExistsError')
            } catch (error) {
              expect(error).to.be.instanceOf(RuleExistsError)
              expect(fileService.write.called).to.be.false
            }
          })

          // eslint-disable-next-line max-nested-callbacks
          it('should append when file exists with BR_RULE_TAG and force=true', async () => {
            fileService.exists.resolves(true)
            fileService.read.resolves(`Existing content\n${BR_RULE_TAG}\nMore content`)
            templateService.generateRuleContent.resolves(`Mock rule content for ${agent}`)

            await service.writeRule(agent, true)

            expect(fileService.exists.calledOnce).to.be.true
            // When force=true, read() is NOT called because the check is skipped
            expect(fileService.read.called).to.be.false
            expect(templateService.generateRuleContent.calledWith(agent)).to.be.true
            expect(fileService.write.calledOnce).to.be.true

            const writeCall = fileService.write.getCall(0)
            expect(writeCall.args[0]).to.equal(`Mock rule content for ${agent}`)
            expect(writeCall.args[2]).to.equal('append')
          })
        })
      }
    })

    describe('file path configuration', () => {
      it('should use correct file path for Claude Code', async () => {
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('Mock content')

        await service.writeRule('Claude Code', false)

        const writeCall = fileService.write.getCall(0)
        expect(writeCall.args[1]).to.equal('CLAUDE.md')
      })

      it('should use correct file path for Cursor', async () => {
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('Mock content')

        await service.writeRule('Cursor', false)

        const writeCall = fileService.write.getCall(0)
        expect(writeCall.args[1]).to.equal('.cursor/rules/agent-context-engineering.mdc')
      })

      it('should use correct file path for Windsurf', async () => {
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('Mock content')

        await service.writeRule('Windsurf', false)

        const writeCall = fileService.write.getCall(0)
        expect(writeCall.args[1]).to.equal('.windsurf/rules/agent-context-engineering.md')
      })

      it('should use correct file path for Cline', async () => {
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('Mock content')

        await service.writeRule('Cline', false)

        const writeCall = fileService.write.getCall(0)
        expect(writeCall.args[1]).to.equal('.clinerules/agent-context-engineering.md')
      })

      it('should use correct file path for Github Copilot', async () => {
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('Mock content')

        await service.writeRule('Github Copilot', false)

        const writeCall = fileService.write.getCall(0)
        expect(writeCall.args[1]).to.equal('.github/copilot-instructions.md')
      })

      it('should use correct file path for Amp', async () => {
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('Mock content')

        await service.writeRule('Amp', false)

        const writeCall = fileService.write.getCall(0)
        expect(writeCall.args[1]).to.equal('AGENTS.md')
      })

      it('should use correct file path for Zed', async () => {
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('Mock content')

        await service.writeRule('Zed', false)

        const writeCall = fileService.write.getCall(0)
        expect(writeCall.args[1]).to.equal('agent-context-engineering.rules')
      })

      it('should use correct file path for Augment Code', async () => {
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('Mock content')

        await service.writeRule('Augment Code', false)

        const writeCall = fileService.write.getCall(0)
        expect(writeCall.args[1]).to.equal('.augment/rules/agent-context-engineering.md')
      })
    })

    describe('error handling', () => {
      it('should throw error for unsupported agent', async () => {
        const unsupportedAgent = 'UnsupportedAgent' as Agent

        try {
          await service.writeRule(unsupportedAgent, false)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('No configuration found for agent: UnsupportedAgent')
          expect(fileService.exists.called).to.be.false
          expect(fileService.write.called).to.be.false
        }
      })

      it('should propagate file service exists errors', async () => {
        fileService.exists.rejects(new Error('File system error'))

        try {
          await service.writeRule('Claude Code', false)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('File system error')
        }
      })

      it('should propagate file service read errors', async () => {
        fileService.exists.resolves(true)
        fileService.read.rejects(new Error('Read permission denied'))

        try {
          await service.writeRule('Claude Code', false)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Read permission denied')
        }
      })

      it('should propagate file service write errors', async () => {
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('Mock content')
        fileService.write.rejects(new Error('Write permission denied'))

        try {
          await service.writeRule('Claude Code', false)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Write permission denied')
        }
      })
    })

    describe('template service integration', () => {
      it('should call template service with correct agent', async () => {
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves('Generated content')

        await service.writeRule('Cursor', false)

        expect(templateService.generateRuleContent.calledOnce).to.be.true
        expect(templateService.generateRuleContent.calledWith('Cursor')).to.be.true
      })

      it('should use template content in write operation', async () => {
        const expectedContent = 'Expected template content\nWith multiple lines'
        fileService.exists.resolves(false)
        templateService.generateRuleContent.resolves(expectedContent)

        await service.writeRule('Windsurf', false)

        expect(fileService.write.calledOnce).to.be.true
        const writeCall = fileService.write.getCall(0)
        expect(writeCall.args[0]).to.equal(expectedContent)
      })
    })

    describe('force flag behavior', () => {
      it('should skip existence check logic when force=true for overwrite mode', async () => {
        fileService.exists.resolves(true)
        templateService.generateRuleContent.resolves('Content')

        await service.writeRule('Cursor', true)

        expect(fileService.write.calledOnce).to.be.true
        expect(fileService.read.called).to.be.false // Should not read file
      })

      it('should not read file when force=true for append mode', async () => {
        fileService.exists.resolves(true)
        fileService.read.resolves(`Content with ${BR_RULE_TAG}`)
        templateService.generateRuleContent.resolves('Content')

        await service.writeRule('Claude Code', true)

        // When force=true, the BR_RULE_TAG check is skipped, so read() is not called
        expect(fileService.read.called).to.be.false
        expect(fileService.write.calledOnce).to.be.true
      })
    })

    describe('BR_RULE_TAG detection', () => {
      it('should detect BR_RULE_TAG at beginning of content', async () => {
        fileService.exists.resolves(true)
        fileService.read.resolves(`${BR_RULE_TAG} at start`)

        try {
          await service.writeRule('Warp', false)
          expect.fail('Should have thrown RuleExistsError')
        } catch (error) {
          expect(error).to.be.instanceOf(RuleExistsError)
        }
      })

      it('should detect BR_RULE_TAG in middle of content', async () => {
        fileService.exists.resolves(true)
        fileService.read.resolves(`Some content\n${BR_RULE_TAG}\nMore content`)

        try {
          await service.writeRule('Gemini CLI', false)
          expect.fail('Should have thrown RuleExistsError')
        } catch (error) {
          expect(error).to.be.instanceOf(RuleExistsError)
        }
      })

      it('should detect BR_RULE_TAG at end of content', async () => {
        fileService.exists.resolves(true)
        fileService.read.resolves(`Content before\n${BR_RULE_TAG}`)

        try {
          await service.writeRule('Junie', false)
          expect.fail('Should have thrown RuleExistsError')
        } catch (error) {
          expect(error).to.be.instanceOf(RuleExistsError)
        }
      })

      it('should not detect partial BR_RULE_TAG match', async () => {
        fileService.exists.resolves(true)
        fileService.read.resolves('Generated by something else')
        templateService.generateRuleContent.resolves('Content')

        // Should not throw since BR_RULE_TAG is not fully present
        await service.writeRule('Trae.ai', false)

        expect(fileService.write.calledOnce).to.be.true
      })
    })

    describe('all supported agents', () => {
      it('should have configuration for all agents', async () => {
        for (const agent of AGENT_VALUES) {
          fileService.exists.resolves(false)
          templateService.generateRuleContent.resolves('Content')

          // Should not throw for any supported agent
          // eslint-disable-next-line no-await-in-loop
          await service.writeRule(agent, false)

          // Reset stubs for next iteration
          fileService.exists.reset()
          templateService.generateRuleContent.reset()
          fileService.write.reset()
        }
      })
    })
  })
})
