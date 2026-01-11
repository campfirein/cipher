import {expect} from 'chai'
import * as sinon from 'sinon'

import type {HookInstallResult, IHookManager} from '../../../../src/core/interfaces/hooks/i-hook-manager.js'
import type {ITerminal} from '../../../../src/core/interfaces/i-terminal.js'

import {
  isHookSupportedAgent,
  tryInstallHookWithRestartMessage,
} from '../../../../src/infra/hooks/hook-install-helper.js'
import {createMockTerminal} from '../../../helpers/mock-factories.js'

describe('hook-install-helper', () => {
  describe('isHookSupportedAgent', () => {
    it('should return true for Claude Code', () => {
      expect(isHookSupportedAgent('Claude Code')).to.be.true
    })

    it('should return false for Cursor (not supported)', () => {
      expect(isHookSupportedAgent('Cursor')).to.be.false
    })

    it('should return false for Github Copilot', () => {
      expect(isHookSupportedAgent('Github Copilot')).to.be.false
    })

    it('should return false for Windsurf', () => {
      expect(isHookSupportedAgent('Windsurf')).to.be.false
    })

    it('should return false for Amp', () => {
      expect(isHookSupportedAgent('Amp')).to.be.false
    })
  })

  describe('tryInstallHookWithRestartMessage', () => {
    let hookManager: sinon.SinonStubbedInstance<IHookManager>
    let terminal: ITerminal
    let warnStub: sinon.SinonStub
    let errorStub: sinon.SinonStub

    beforeEach(() => {
      hookManager = {
        getSupportedAgents: sinon.stub(),
        install: sinon.stub(),
        status: sinon.stub(),
        uninstall: sinon.stub(),
      }

      warnStub = sinon.stub()
      errorStub = sinon.stub()
      terminal = createMockTerminal({
        error: errorStub,
        warn: warnStub,
      })
    })

    afterEach(() => {
      sinon.restore()
    })

    describe('when hookManager is undefined', () => {
      it('should return early without calling anything', async () => {
        await tryInstallHookWithRestartMessage({
          agent: 'Claude Code',
          hookManager: undefined,
          terminal,
        })

        expect(warnStub.called).to.be.false
        expect(errorStub.called).to.be.false
      })
    })

    describe('when agent does not support hooks', () => {
      it('should return early for Github Copilot', async () => {
        await tryInstallHookWithRestartMessage({
          agent: 'Github Copilot',
          hookManager,
          terminal,
        })

        expect(hookManager.install.called).to.be.false
        expect(warnStub.called).to.be.false
      })

      it('should return early for Windsurf', async () => {
        await tryInstallHookWithRestartMessage({
          agent: 'Windsurf',
          hookManager,
          terminal,
        })

        expect(hookManager.install.called).to.be.false
        expect(warnStub.called).to.be.false
      })
    })

    describe('when hook is newly installed', () => {
      it('should show restart warning for Claude Code', async () => {
        hookManager.install.resolves({
          alreadyInstalled: false,
          configPath: '.claude/settings.local.json',
          message: 'Installed',
          success: true,
        } satisfies HookInstallResult)

        await tryInstallHookWithRestartMessage({
          agent: 'Claude Code',
          hookManager,
          terminal,
        })

        expect(hookManager.install.calledOnceWith('Claude Code')).to.be.true
        expect(warnStub.calledOnce).to.be.true
        expect(warnStub.firstCall.args[0]).to.include('restart')
        expect(warnStub.firstCall.args[0]).to.include('Claude Code')
      })
    })

    describe('when hook is already installed', () => {
      it('should NOT show restart warning', async () => {
        hookManager.install.resolves({
          alreadyInstalled: true,
          configPath: '.claude/settings.local.json',
          message: 'Already installed',
          success: true,
        } satisfies HookInstallResult)

        await tryInstallHookWithRestartMessage({
          agent: 'Claude Code',
          hookManager,
          terminal,
        })

        expect(hookManager.install.calledOnce).to.be.true
        expect(warnStub.called).to.be.false
      })
    })

    describe('when hook installation fails', () => {
      it('should NOT show restart warning when success is false', async () => {
        hookManager.install.resolves({
          alreadyInstalled: false,
          configPath: '.claude/settings.local.json',
          message: 'Failed',
          success: false,
        } satisfies HookInstallResult)

        await tryInstallHookWithRestartMessage({
          agent: 'Claude Code',
          hookManager,
          terminal,
        })

        expect(warnStub.called).to.be.false
        expect(errorStub.called).to.be.false // No error on failure result
      })
    })

    describe('when hook installation throws', () => {
      it('should catch error and show error message', async () => {
        hookManager.install.rejects(new Error('Permission denied'))

        await tryInstallHookWithRestartMessage({
          agent: 'Claude Code',
          hookManager,
          terminal,
        })

        expect(warnStub.called).to.be.false
        expect(errorStub.calledOnce).to.be.true
        expect(errorStub.firstCall.args[0]).to.include('Permission denied')
        expect(errorStub.firstCall.args[0]).to.include('Claude Code')
      })
    })
  })
})
