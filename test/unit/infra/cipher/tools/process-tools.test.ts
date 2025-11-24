import {expect} from 'chai'
import {createSandbox, SinonStub} from 'sinon'

import type {IProcessService} from '../../../../../src/core/interfaces/cipher/i-process-service.js'
import type {BashExecBackgroundResult, KillProcessResult} from '../../../../shared/tool-result-types.js'

import {createBashExecTool} from '../../../../../src/infra/cipher/tools/implementations/bash-exec-tool.js'
import {createBashOutputTool} from '../../../../../src/infra/cipher/tools/implementations/bash-output-tool.js'
import {createKillProcessTool} from '../../../../../src/infra/cipher/tools/implementations/kill-process-tool.js'

describe('Process Tools', () => {
  const sandbox = createSandbox()
  let processServiceMock: IProcessService
  let executeCommandStub: SinonStub
  let getProcessOutputStub: SinonStub
  let killProcessStub: SinonStub

  beforeEach(() => {
    executeCommandStub = sandbox.stub()
    getProcessOutputStub = sandbox.stub()
    killProcessStub = sandbox.stub()

    processServiceMock = {
      executeCommand: executeCommandStub,
      getProcessOutput: getProcessOutputStub,
      killProcess: killProcessStub,
    } as unknown as IProcessService
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('bash_exec', () => {
    it('should execute foreground command successfully', async () => {
      const tool = createBashExecTool(processServiceMock as IProcessService)
      const mockResult = {
        duration: 100,
        exitCode: 0,
        stderr: '',
        stdout: 'output',
      }
      executeCommandStub.resolves(mockResult)

      const result = await tool.execute({command: 'echo hello'})

      sandbox.assert.calledWith(
        executeCommandStub,
        'echo hello',
        sandbox.match({
          cwd: undefined,
          description: undefined,
          runInBackground: undefined,
          timeout: undefined,
        }),
      )
      expect(result).to.deep.equal(mockResult)
    })

    it('should execute background command successfully', async () => {
      const tool = createBashExecTool(processServiceMock as IProcessService)
      const date = new Date()
      const mockResult = {
        command: 'sleep 10',
        description: 'sleeping',
        pid: 123,
        processId: 'proc-123',
        startedAt: date,
      }
      executeCommandStub.resolves(mockResult)

      const result = (await tool.execute({
        command: 'sleep 10',
        description: 'sleeping',
        runInBackground: true,
      })) as BashExecBackgroundResult

      sandbox.assert.calledWith(
        executeCommandStub,
        'sleep 10',
        sandbox.match({
          cwd: undefined,
          description: 'sleeping',
          runInBackground: true,
          timeout: undefined,
        }),
      )
      expect(result.processId).to.equal('proc-123')
      expect(result.message).to.include('bash_output')
    })

    it('should handle timeout and cwd options', async () => {
      const tool = createBashExecTool(processServiceMock as IProcessService)
      executeCommandStub.resolves({
        duration: 100,
        exitCode: 0,
        stderr: '',
        stdout: '',
      })

      await tool.execute({
        command: 'ls',
        cwd: '/tmp',
        timeout: 5000,
      })

      expect(executeCommandStub.args[0][1]).to.include({
        cwd: '/tmp',
        timeout: 5000,
      })
    })

    it('should propagate timeout error', async () => {
      const tool = createBashExecTool(processServiceMock as IProcessService)
      const error = new Error('Command timed out')
      error.name = 'ProcessError'
      executeCommandStub.rejects(error)

      try {
        await tool.execute({command: 'sleep 1000', timeout: 100})
        expect.fail('Should have thrown an error')
      } catch (error_: unknown) {
        expect((error_ as Error).message).to.include('timed out')
      }
    })

    it('should propagate command not found error', async () => {
      const tool = createBashExecTool(processServiceMock as IProcessService)
      const error = new Error('Command not found')
      error.name = 'ProcessError'
      executeCommandStub.rejects(error)

      try {
        await tool.execute({command: 'nonexistentcommand'})
        expect.fail('Should have thrown an error')
      } catch (error_: unknown) {
        expect((error_ as Error).message).to.include('not found')
      }
    })

    it('should propagate permission denied error', async () => {
      const tool = createBashExecTool(processServiceMock as IProcessService)
      const error = new Error('Permission denied')
      error.name = 'ProcessError'
      executeCommandStub.rejects(error)

      try {
        await tool.execute({command: '/restricted/command'})
        expect.fail('Should have thrown an error')
      } catch (error_: unknown) {
        expect((error_ as Error).message).to.include('Permission denied')
      }
    })

    it('should propagate invalid command error', async () => {
      const tool = createBashExecTool(processServiceMock as IProcessService)
      const error = new Error('Invalid command')
      error.name = 'ProcessError'
      executeCommandStub.rejects(error)

      try {
        await tool.execute({command: ''})
        expect.fail('Should have thrown an error')
      } catch (error_: unknown) {
        expect((error_ as Error).message).to.include('Invalid command')
      }
    })
  })

  describe('bash_output', () => {
    it('should retrieve process output successfully', async () => {
      const tool = createBashOutputTool(processServiceMock as IProcessService)
      const mockResult = {
        duration: 1000,
        exitCode: 0,
        status: 'completed',
        stderr: '',
        stdout: 'done',
      }
      getProcessOutputStub.resolves(mockResult)

      const result = await tool.execute({processId: 'proc-123'})

      sandbox.assert.calledWith(getProcessOutputStub, 'proc-123')
      expect(result).to.deep.include({
        processId: 'proc-123',
        status: 'completed',
        stdout: 'done',
      })
    })

    it('should propagate process not found error', async () => {
      const tool = createBashOutputTool(processServiceMock as IProcessService)
      const error = new Error('Process not found')
      error.name = 'ProcessError'
      getProcessOutputStub.rejects(error)

      try {
        await tool.execute({processId: 'invalid-proc'})
        expect.fail('Should have thrown an error')
      } catch (error_: unknown) {
        expect((error_ as Error).message).to.include('not found')
      }
    })
  })

  describe('kill_process', () => {
    it('should kill process successfully', async () => {
      const tool = createKillProcessTool(processServiceMock as IProcessService)
      killProcessStub.resolves()

      const result = (await tool.execute({processId: 'proc-123'})) as KillProcessResult

      sandbox.assert.calledWith(killProcessStub, 'proc-123')
      expect(result.success).to.be.true
      expect(result.message).to.include('terminated successfully')
    })

    it('should propagate process not found error', async () => {
      const tool = createKillProcessTool(processServiceMock as IProcessService)
      const error = new Error('Process not found')
      error.name = 'ProcessError'
      killProcessStub.rejects(error)

      try {
        await tool.execute({processId: 'invalid-proc'})
        expect.fail('Should have thrown an error')
      } catch (error_: unknown) {
        expect((error_ as Error).message).to.include('not found')
      }
    })

    it('should handle kill failure gracefully', async () => {
      const tool = createKillProcessTool(processServiceMock as IProcessService)
      const error = new Error('Failed to kill process')
      error.name = 'ProcessError'
      killProcessStub.rejects(error)

      try {
        await tool.execute({processId: 'proc-123'})
        expect.fail('Should have thrown an error')
      } catch (error_: unknown) {
        expect((error_ as Error).message).to.include('kill')
      }
    })
  })
})
