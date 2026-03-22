import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {ISandboxService} from '../../../../../src/agent/core/interfaces/i-sandbox-service.js'

import {createCodeExecTool} from '../../../../../src/agent/infra/tools/implementations/code-exec-tool.js'

describe('createCodeExecTool', () => {
  afterEach(() => {
    restore()
  })

  it('should preserve curateResults when large stdout is redirected to a sandbox variable', async () => {
    const curateResults = [{applied: [{path: 'security/authentication/jwt', status: 'success', type: 'UPSERT'}]}]
    const sandboxService = {
      executeCode: stub().resolves({
        curateResults,
        executionTime: 12,
        locals: {},
        stderr: '',
        stdout: 'x'.repeat(2501),
      }),
      setSandboxVariable: stub(),
    } as unknown as ISandboxService

    const tool = createCodeExecTool(sandboxService)
    const result = await tool.execute(
      {code: 'await tools.curate([])', silent: false, timeout: 30_000},
      {commandType: 'curate', sessionId: 'session-1'},
    ) as Record<string, unknown>

    expect(result.curateResults).to.deep.equal(curateResults)
    expect(result.stdout).to.be.a('string')
    expect(result.stdout as string).to.include('stored in variable')
    expect((sandboxService.setSandboxVariable as ReturnType<typeof stub>).calledOnce).to.be.true
  })
})
