/**
 * code_exec tool — harness field forwarding tests.
 *
 * Verifies that `taskDescription` and `conversationTurn` on
 * `ToolExecutionContext` are forwarded into `SandboxConfig` when
 * `code_exec` calls `sandboxService.executeCode()`.
 *
 * ENG-2233 (Phase 2 Task 2.4)
 */

import {expect} from 'chai'
import sinon from 'sinon'

import type {SandboxConfig} from '../../../../src/agent/core/domain/sandbox/types.js'
import type {ToolExecutionContext} from '../../../../src/agent/core/domain/tools/types.js'
import type {ISandboxService} from '../../../../src/agent/core/interfaces/i-sandbox-service.js'

import {createCodeExecTool} from '../../../../src/agent/infra/tools/implementations/code-exec-tool.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSandboxService(): ISandboxService & {lastConfig?: SandboxConfig} {
  const svc: ISandboxService & {lastConfig?: SandboxConfig} = {
    async cleanup() {},
    async clearSession() {},
    deleteSandboxVariable() {},
    async executeCode(_code: string, _sessionId: string, config?: SandboxConfig) {
      svc.lastConfig = config
      return {executionTime: 1, locals: {}, stderr: '', stdout: ''}
    },
    setSandboxVariable() {},
  }
  return svc
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('code_exec tool — harness field forwarding', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('forwards taskDescription from ToolExecutionContext to SandboxConfig', async () => {
    const sandbox = makeSandboxService()
    const tool = createCodeExecTool(sandbox)

    const context: ToolExecutionContext = {
      sessionId: 'sess-1',
      taskDescription: 'find the auth module',
    }

    await tool.execute({code: '1 + 1'}, context)

    expect(sandbox.lastConfig?.taskDescription).to.equal('find the auth module')
  })

  it('forwards conversationTurn from ToolExecutionContext to SandboxConfig', async () => {
    const sandbox = makeSandboxService()
    const tool = createCodeExecTool(sandbox)

    const context: ToolExecutionContext = {
      conversationTurn: 3,
      sessionId: 'sess-1',
    }

    await tool.execute({code: '1 + 1'}, context)

    expect(sandbox.lastConfig?.conversationTurn).to.equal(3)
  })

  it('leaves both fields undefined when context does not provide them', async () => {
    const sandbox = makeSandboxService()
    const tool = createCodeExecTool(sandbox)

    const context: ToolExecutionContext = {
      sessionId: 'sess-1',
    }

    await tool.execute({code: '1 + 1'}, context)

    expect(sandbox.lastConfig?.taskDescription).to.equal(undefined)
    expect(sandbox.lastConfig?.conversationTurn).to.equal(undefined)
  })

  it('preserves taskDescription as-is (truncation is the caller responsibility)', async () => {
    const sandbox = makeSandboxService()
    const tool = createCodeExecTool(sandbox)

    // The tool forwards whatever it receives — truncation happens in AgentLLMService
    const longDesc = 'x'.repeat(600)
    const context: ToolExecutionContext = {
      sessionId: 'sess-1',
      taskDescription: longDesc,
    }

    await tool.execute({code: '1'}, context)

    expect(sandbox.lastConfig?.taskDescription).to.equal(longDesc)
    expect(sandbox.lastConfig?.taskDescription).to.have.length(600)
  })

  it('forwards both fields together alongside existing config fields', async () => {
    const sandbox = makeSandboxService()
    const tool = createCodeExecTool(sandbox)

    const context: ToolExecutionContext = {
      commandType: 'curate',
      conversationTurn: 0,
      sessionId: 'sess-1',
      taskDescription: 'curate project docs',
    }

    await tool.execute({code: '1 + 1', timeout: 5000}, context)

    expect(sandbox.lastConfig?.commandType).to.equal('curate')
    expect(sandbox.lastConfig?.taskDescription).to.equal('curate project docs')
    expect(sandbox.lastConfig?.conversationTurn).to.equal(0)
    expect(sandbox.lastConfig?.timeout).to.equal(5000)
  })
})
