import {expect} from 'chai'
import {mkdir, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout} from 'node:timers/promises'

import type {
  BashExecBackgroundResult,
  BashExecForegroundResult,
  BashOutputResult,
  KillProcessResult,
} from '../../../../shared/tool-result-types.js'

import {ProcessService} from '../../../../../src/infra/cipher/process/process-service.js'
import {createBashExecTool} from '../../../../../src/infra/cipher/tools/implementations/bash-exec-tool.js'
import {createBashOutputTool} from '../../../../../src/infra/cipher/tools/implementations/bash-output-tool.js'
import {createKillProcessTool} from '../../../../../src/infra/cipher/tools/implementations/kill-process-tool.js'

const TEST_TIMEOUT_MS = 35

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
      })) as BashExecForegroundResult

      expect(result.stdout).to.include('hello world')
      expect(result.exitCode).to.equal(0)
    })

    it('should execute background command', async () => {
      const tool = createBashExecTool(processService)
      const result = (await tool.execute({
        command: 'sleep 1',
        runInBackground: true,
      })) as BashExecBackgroundResult

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
      })) as BashExecBackgroundResult

      // Wait a bit for output
      await setTimeout(TEST_TIMEOUT_MS)

      // Get output
      const outputResult = (await outputTool.execute({
        processId: startResult.processId,
      })) as BashOutputResult

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
      })) as BashExecBackgroundResult

      // Kill it
      const killResult = (await killTool.execute({
        processId: startResult.processId,
      })) as KillProcessResult

      expect(killResult.success).to.be.true

      // Wait for process to actually terminate (SIGTERM takes a moment)
      await setTimeout(TEST_TIMEOUT_MS)

      // Verify status after waiting
      const outputResult = (await outputTool.execute({
        processId: startResult.processId,
      })) as BashOutputResult

      // Process should no longer be running
      expect(outputResult.status).to.not.equal('running')
    })
  })
})
