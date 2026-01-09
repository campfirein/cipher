import {expect} from 'chai'
import sinon, {type SinonStub} from 'sinon'

import type {Agent} from '../../../../src/core/domain/entities/agent.js'
import type {HookInstallResult, IHookManager} from '../../../../src/core/interfaces/hooks/i-hook-manager.js'
import type {IFileService} from '../../../../src/core/interfaces/i-file-service.js'
import type {IRuleTemplateService} from '../../../../src/core/interfaces/i-rule-template-service.js'
import type {ITerminal} from '../../../../src/core/interfaces/i-terminal.js'
import type {ITrackingService} from '../../../../src/core/interfaces/i-tracking-service.js'

import {LegacyRuleDetector} from '../../../../src/infra/rule/legacy-rule-detector.js'
import {GenerateRulesUseCase} from '../../../../src/infra/usecase/generate-rules-use-case.js'

describe('GenerateRulesUseCase', () => {
  // Stubs
  let fileService: sinon.SinonStubbedInstance<IFileService>
  let templateService: sinon.SinonStubbedInstance<IRuleTemplateService>
  let terminal: sinon.SinonStubbedInstance<ITerminal>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let hookManager: sinon.SinonStubbedInstance<IHookManager>
  let legacyRuleDetector: LegacyRuleDetector

  beforeEach(() => {
    // Create stubs
    fileService = {
      createBackup: sinon.stub().resolves('/backup/path'),
      exists: sinon.stub().resolves(false),
      read: sinon.stub().resolves(''),
      write: sinon.stub().resolves(),
    } as unknown as sinon.SinonStubbedInstance<IFileService>

    templateService = {
      generateRuleContent: sinon.stub().resolves('<!-- ByteRover Rules -->'),
    } as unknown as sinon.SinonStubbedInstance<IRuleTemplateService>

    terminal = {
      actionStart: sinon.stub(),
      actionStop: sinon.stub(),
      confirm: sinon.stub(),
      error: sinon.stub(),
      fileSelector: sinon.stub(),
      input: sinon.stub(),
      log: sinon.stub(),
      search: sinon.stub(),
      select: sinon.stub(),
      warn: sinon.stub(),
    } as unknown as sinon.SinonStubbedInstance<ITerminal>

    trackingService = {
      track: sinon.stub().resolves(),
    } as unknown as sinon.SinonStubbedInstance<ITrackingService>

    hookManager = {
      getSupportedAgents: sinon.stub().returns(['Claude Code', 'Cursor']),
      install: sinon.stub(),
      status: sinon.stub(),
      uninstall: sinon.stub(),
    } as unknown as sinon.SinonStubbedInstance<IHookManager>

    legacyRuleDetector = new LegacyRuleDetector()
  })

  afterEach(() => {
    sinon.restore()
  })

  /**
   * Helper to create UseCase and simulate agent selection
   */
  function createUseCaseWithAgentSelection(agent: Agent): GenerateRulesUseCase {
    // Stub terminal.search to return the selected agent (used by promptForAgentSelection)
    ;(terminal.search as SinonStub).resolves(agent)
    // Stub terminal.confirm for file creation confirmation
    ;(terminal.confirm as SinonStub).resolves(true)

    return new GenerateRulesUseCase(
      fileService,
      legacyRuleDetector,
      templateService,
      terminal,
      trackingService,
      hookManager,
    )
  }

  describe('hook integration', () => {
    describe('when agent supports hooks', () => {
      it('should install hook for Claude Code', async () => {
        const useCase = createUseCaseWithAgentSelection('Claude Code')
        ;(hookManager.install as SinonStub).resolves({
          alreadyInstalled: false,
          configPath: '.claude/settings.local.json',
          message: 'Installed',
          success: true,
        } satisfies HookInstallResult)

        await useCase.run()

        expect((hookManager.install as SinonStub).calledOnce).to.be.true
        expect((hookManager.install as SinonStub).calledWith('Claude Code')).to.be.true
      })

      it('should install hook for Cursor', async () => {
        const useCase = createUseCaseWithAgentSelection('Cursor')
        ;(hookManager.install as SinonStub).resolves({
          alreadyInstalled: false,
          configPath: '.cursor/hooks.json',
          message: 'Installed',
          success: true,
        } satisfies HookInstallResult)

        await useCase.run()

        expect((hookManager.install as SinonStub).calledOnce).to.be.true
        expect((hookManager.install as SinonStub).calledWith('Cursor')).to.be.true
      })

      it('should show restart message when hook newly installed', async () => {
        const useCase = createUseCaseWithAgentSelection('Claude Code')
        ;(hookManager.install as SinonStub).resolves({
          alreadyInstalled: false,
          configPath: '.claude/settings.local.json',
          message: 'Installed',
          success: true,
        } satisfies HookInstallResult)

        await useCase.run()

        expect((terminal.error as SinonStub).calledOnce).to.be.true
        expect((terminal.error as SinonStub).firstCall.args[0]).to.include('restart')
        expect((terminal.error as SinonStub).firstCall.args[0]).to.include('Claude Code')
      })

      it('should ALWAYS show restart message even when hook already installed', async () => {
        const useCase = createUseCaseWithAgentSelection('Claude Code')
        ;(hookManager.install as SinonStub).resolves({
          alreadyInstalled: true,
          configPath: '.claude/settings.local.json',
          message: 'Already installed',
          success: true,
        } satisfies HookInstallResult)

        await useCase.run()

        // Always show restart message regardless of alreadyInstalled
        expect((terminal.error as SinonStub).calledOnce).to.be.true
        expect((terminal.error as SinonStub).firstCall.args[0]).to.include('restart')
      })

      it('should NOT show restart message when hook installation fails', async () => {
        const useCase = createUseCaseWithAgentSelection('Claude Code')
        ;(hookManager.install as SinonStub).resolves({
          alreadyInstalled: false,
          configPath: '.claude/settings.local.json',
          message: 'Failed',
          success: false,
        } satisfies HookInstallResult)

        await useCase.run()

        expect((terminal.error as SinonStub).called).to.be.false
      })
    })

    describe('when agent does NOT support hooks', () => {
      it('should silently skip hook installation for Github Copilot', async () => {
        const useCase = createUseCaseWithAgentSelection('Github Copilot')

        await useCase.run()

        expect((hookManager.install as SinonStub).called).to.be.false
        expect((terminal.error as SinonStub).called).to.be.false
      })

      it('should silently skip hook installation for Amp', async () => {
        const useCase = createUseCaseWithAgentSelection('Amp')

        await useCase.run()

        expect((hookManager.install as SinonStub).called).to.be.false
        expect((terminal.error as SinonStub).called).to.be.false
      })
    })

    describe('error handling', () => {
      it('should silently ignore hook installation errors', async () => {
        const useCase = createUseCaseWithAgentSelection('Claude Code')
        ;(hookManager.install as SinonStub).rejects(new Error('Permission denied'))

        // Should not throw
        await useCase.run()

        // Rule generation should still complete
        expect((terminal.log as SinonStub).called).to.be.true
        expect((fileService.write as SinonStub).called).to.be.true
      })
    })

    describe('when hookManager is not provided', () => {
      it('should work normally without hookManager', async () => {
        // Create UseCase without hookManager
        ;(terminal.search as SinonStub).resolves('Claude Code')
        ;(terminal.confirm as SinonStub).resolves(true)

        const useCaseWithoutHook = new GenerateRulesUseCase(
          fileService,
          legacyRuleDetector,
          templateService,
          terminal,
          trackingService,
          // No hookManager
        )

        // Should not throw
        await useCaseWithoutHook.run()

        // Rule generation should complete
        expect((terminal.log as SinonStub).called).to.be.true
        expect((fileService.write as SinonStub).called).to.be.true
      })
    })
  })
})
