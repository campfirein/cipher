/**
 * FolderPackExecutor tests
 *
 * 1. Variable naming regression: UUID hyphens in instructionsVar cause
 *    ReferenceError when the LLM calls instructionsVar.slice(...) in code-exec.
 *
 * 2. Workspace path resolution (PR3): relative folderPath resolves from clientCwd,
 *    absent folderPath defaults to workspaceRoot, absolute folderPath used as-is.
 */

import {expect} from 'chai'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {restore, stub} from 'sinon'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {IFolderPackService} from '../../../../src/agent/core/interfaces/i-folder-pack-service.js'

import {LocalSandbox} from '../../../../src/agent/infra/sandbox/local-sandbox.js'
import {FolderPackExecutor} from '../../../../src/server/infra/executor/folder-pack-executor.js'

function createMockAgent(): ICipherAgent {
  return {
    cancel: stub().resolves(false),
    createTaskSession: stub().resolves('session-1'),
    deleteSandboxVariable: stub(),
    deleteSandboxVariableOnSession: stub(),
    deleteSession: stub().resolves(true),
    deleteTaskSession: stub().resolves(),
    execute: stub().resolves(''),
    executeOnSession: stub().resolves('curated'),
    generate: stub().resolves({content: '', toolCalls: [], usage: {inputTokens: 0, outputTokens: 0}}),
    getSessionMetadata: stub().resolves(),
    getState: stub().returns({currentIteration: 0, executionHistory: [], executionState: 'idle', toolCallsExecuted: 0}),
    listPersistedSessions: stub().resolves([]),
    reset: stub(),
    setSandboxVariable: stub(),
    setSandboxVariableOnSession: stub(),
    setupTaskForwarding: stub().returns(() => {}),
    start: stub().resolves(),
    stream: stub().resolves({[Symbol.asyncIterator]: () => ({next: () => Promise.resolve({done: true, value: undefined})})}),
  } as unknown as ICipherAgent
}

function createMockFolderPackService(packStub?: ReturnType<typeof stub>): IFolderPackService {
  return {
    generateXml: stub().returns('<packed_folder></packed_folder>'),
    initialize: stub().resolves(),
    pack: packStub ?? stub().resolves({fileCount: 1, files: [], totalLines: 10}),
  } as unknown as IFolderPackService
}

describe('FolderPackExecutor', () => {
  describe('instructionsVar naming (regression)', () => {
    const taskId = '8cd8e2d8-a7fc-4371-89ca-59460687c12d'
    const llmGeneratedVarName = '__curate_instructions_8cd8e2d8_a7fc_4371_89ca_59460687c12d'
    const instructions = 'Step 1: read files. Step 2: curate topics.'

    describe('bug: hyphenated taskId causes ReferenceError on .slice()', () => {
      it('should fail when instructionsVar stored with hyphens and LLM calls .slice()', async () => {
        const sandbox = new LocalSandbox()

        const buggyVar = `__curate_instructions_${taskId}`
        sandbox.updateContext({[buggyVar]: instructions})

        const result = await sandbox.execute(`${llmGeneratedVarName}.slice(0, 5)`)

        expect(result.stderr).to.include('ReferenceError')
      })
    })

    describe('fix: taskIdSafe with underscores matches LLM output', () => {
      it('should succeed when instructionsVar stored with underscores', async () => {
        const sandbox = new LocalSandbox()

        const taskIdSafe = taskId.replaceAll('-', '_')
        const fixedVar = `__curate_instructions_${taskIdSafe}`
        sandbox.updateContext({[fixedVar]: instructions})

        const result = await sandbox.execute(`${llmGeneratedVarName}.slice(0, 4)`)

        expect(result.stderr).to.equal('')
        expect(result.returnValue).to.equal('Step')
      })

      it('should correctly transform all UUID segments', () => {
        const taskIdSafe = taskId.replaceAll('-', '_')

        expect(taskIdSafe).to.not.include('-')
        expect(taskIdSafe).to.equal('8cd8e2d8_a7fc_4371_89ca_59460687c12d')

        const instructionsVar = `__curate_instructions_${taskIdSafe}`
        expect(instructionsVar).to.equal(llmGeneratedVarName)
      })
    })
  })

  describe('workspace path resolution (PR3)', () => {
    let testDir: string

    beforeEach(async () => {
      testDir = path.join(tmpdir(), `brv-fp-test-${Date.now()}`)
      await mkdir(testDir, {recursive: true})
    })

    afterEach(async () => {
      restore()
      await rm(testDir, {force: true, recursive: true})
    })

    describe('relative folderPath resolves from clientCwd (shell semantics)', () => {
      it('should resolve relative folderPath from clientCwd, not workspaceRoot', async () => {
        const packStub = stub().resolves({fileCount: 1, files: [], totalLines: 10})
        const service = createMockFolderPackService(packStub)
        const executor = new FolderPackExecutor(service)
        const agent = createMockAgent()

        const clientCwd = path.join(testDir, 'packages/api')
        await mkdir(clientCwd, {recursive: true})

        await executor.executeWithAgent(agent, {
          clientCwd,
          folderPath: './src',
          projectRoot: testDir,
          taskId: 'task-1',
          workspaceRoot: path.join(testDir, 'packages/api'),
        })

        const resolvedPath = packStub.firstCall.args[0]
        expect(resolvedPath).to.equal(path.resolve(clientCwd, './src'))
      })
    })

    describe('absolute folderPath used as-is', () => {
      it('should use absolute folderPath without resolving', async () => {
        const packStub = stub().resolves({fileCount: 1, files: [], totalLines: 10})
        const service = createMockFolderPackService(packStub)
        const executor = new FolderPackExecutor(service)
        const agent = createMockAgent()

        const absoluteFolder = path.join(testDir, 'external')
        await mkdir(absoluteFolder, {recursive: true})

        await executor.executeWithAgent(agent, {
          clientCwd: testDir,
          folderPath: absoluteFolder,
          projectRoot: testDir,
          taskId: 'task-2',
        })

        const resolvedPath = packStub.firstCall.args[0]
        expect(resolvedPath).to.equal(absoluteFolder)
      })
    })

    describe('absent folderPath defaults to workspaceRoot', () => {
      it('should default to workspaceRoot when folderPath is not provided', async () => {
        const packStub = stub().resolves({fileCount: 1, files: [], totalLines: 10})
        const service = createMockFolderPackService(packStub)
        const executor = new FolderPackExecutor(service)
        const agent = createMockAgent()

        const workspaceRoot = path.join(testDir, 'packages/api')
        await mkdir(workspaceRoot, {recursive: true})

        await executor.executeWithAgent(agent, {
          clientCwd: path.join(workspaceRoot, 'src'),
          projectRoot: testDir,
          taskId: 'task-3',
          workspaceRoot,
        })

        const resolvedPath = packStub.firstCall.args[0]
        expect(resolvedPath).to.equal(workspaceRoot)
      })

      it('should fall back to clientCwd when both folderPath and workspaceRoot are absent', async () => {
        const packStub = stub().resolves({fileCount: 1, files: [], totalLines: 10})
        const service = createMockFolderPackService(packStub)
        const executor = new FolderPackExecutor(service)
        const agent = createMockAgent()

        await executor.executeWithAgent(agent, {
          clientCwd: testDir,
          projectRoot: testDir,
          taskId: 'task-4',
        })

        const resolvedPath = packStub.firstCall.args[0]
        expect(resolvedPath).to.equal(testDir)
      })
    })
  })
})
