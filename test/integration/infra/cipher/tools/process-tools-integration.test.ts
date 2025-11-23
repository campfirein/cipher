/* eslint-disable @typescript-eslint/no-explicit-any */
import {expect} from 'chai'
import {mkdir, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {ProcessService} from '../../../../../src/infra/cipher/process/process-service.js'
import {createBashExecTool} from '../../../../../src/infra/cipher/tools/implementations/bash-exec-tool.js'
import {createBashOutputTool} from '../../../../../src/infra/cipher/tools/implementations/bash-output-tool.js'
import {createKillProcessTool} from '../../../../../src/infra/cipher/tools/implementations/kill-process-tool.js'

describe('Process Tools Integration', () => {
  let testDir: string
  let processService: ProcessService

  beforeEach(async () => {
    const tmp = await realpath(tmpdir())
    testDir = join(tmp, `byterover-test-proc-${Date.now()}-${Math.random().toString(36).slice(7)}`)
    await mkdir(testDir, {recursive: true})

    processService = new ProcessService({
      securityLevel: 'permissive', // Allow all commands for testing
      workingDirectory: testDir,
    })
    await processService.initialize()
  })

  afterEach(async () => {
    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('bash_exec', () => {
    it('should execute foreground command', async () => {
      const tool = createBashExecTool(processService)
      const result = (await tool.execute({
        command: 'echo "hello world"',
      })) as any

      expect(result.stdout).to.include('hello world')
      expect(result.exitCode).to.equal(0)
    })

    it('should execute background command', async () => {
      const tool = createBashExecTool(processService)
      const result = (await tool.execute({
        command: 'sleep 1',
        runInBackground: true,
      })) as any

      expect(result.processId).to.exist
      expect(result.message).to.include('background')
    })
  })

  describe('bash_output', () => {
    it('should retrieve output from background process', async () => {
      const execTool = createBashExecTool(processService)
      const outputTool = createBashOutputTool(processService)

      // Start background process
      const startResult = (await execTool.execute({
        command: 'echo "background output" && sleep 1',
        runInBackground: true,
      })) as any

      // Wait a bit for output
      await new Promise((resolve) => {
        setTimeout(resolve, 500)
      })

      // Get output
      const outputResult = (await outputTool.execute({
        processId: startResult.processId,
      })) as any

      expect(outputResult.stdout).to.include('background output')
      expect(outputResult.status).to.be.oneOf(['running', 'completed'])
    })
  })

  describe('kill_process', () => {
    it('should kill background process', async () => {
      const execTool = createBashExecTool(processService)
      const killTool = createKillProcessTool(processService)
      const outputTool = createBashOutputTool(processService)

      // Start long running process
      const startResult = (await execTool.execute({
        command: 'sleep 10',
        runInBackground: true,
      })) as any

      // Kill it
      const killResult = (await killTool.execute({
        processId: startResult.processId,
      })) as any

      expect(killResult.success).to.be.true

      // Wait for process to actually terminate (SIGTERM takes a moment)
      await new Promise((resolve) => {
        setTimeout(resolve, 1500)
      })

      // Verify status after waiting
      const outputResult = (await outputTool.execute({
        processId: startResult.processId,
      })) as any

      // Process should no longer be running
      expect(outputResult.status).to.not.equal('running')
    })
  })
})
