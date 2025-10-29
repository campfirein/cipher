import {expect} from 'chai'
import {readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {ExecutorOutput} from '../../../../src/core/domain/entities/executor-output.js'
import {FileExecutorOutputStore} from '../../../../src/infra/ace/file-executor-output-store.js'

describe('FileExecutorOutputStore', () => {
  let store: FileExecutorOutputStore
  let testDir: string

  beforeEach(() => {
    store = new FileExecutorOutputStore()
    testDir = join(tmpdir(), `byterover-test-${Date.now()}`)
  })

  describe('save', () => {
    it('should save executor output with hint from output', async () => {
      const executorOutput = new ExecutorOutput({
        bulletIds: ['bullet-1', 'bullet-2'],
        finalAnswer: 'Task completed successfully',
        hint: 'user-auth',
        reasoning: 'Implemented OAuth2 flow',
        toolUsage: ['Read:src/auth.ts', 'Edit:src/auth.ts'],
      })

      const filePath = await store.save(executorOutput, testDir)

      // Verify file path structure
      expect(filePath).to.include('.br/ace/executor-outputs')
      expect(filePath).to.include('executor-user-auth-')
      expect(filePath).to.include('.json')

      // Verify file contents
      const content = await readFile(filePath, 'utf8')
      const saved = JSON.parse(content)

      expect(saved.hint).to.equal('user-auth')
      expect(saved.finalAnswer).to.equal('Task completed successfully')
      expect(saved.bulletIds).to.deep.equal(['bullet-1', 'bullet-2'])
      expect(saved.toolUsage).to.deep.equal(['Read:src/auth.ts', 'Edit:src/auth.ts'])
    })

    it('should save executor output without hint', async () => {
      const executorOutput = new ExecutorOutput({
        bulletIds: [],
        finalAnswer: 'Done',
        hint: '',
        reasoning: 'Simple task',
        toolUsage: [],
      })

      const filePath = await store.save(executorOutput, testDir)

      // Verify filename pattern without hint
      expect(filePath).to.include('.br/ace/executor-outputs/executor-')
      expect(filePath).to.not.include('executor--')
      expect(filePath).to.include('.json')
    })

    it('should create directory if it does not exist', async () => {
      const executorOutput = new ExecutorOutput({
        bulletIds: [],
        finalAnswer: 'Test',
        hint: 'test',
        reasoning: 'Test',
        toolUsage: [],
      })

      // Should not throw when directory doesn't exist
      const filePath = await store.save(executorOutput, testDir)

      expect(filePath).to.exist
      const content = await readFile(filePath, 'utf8')
      expect(content).to.exist
    })

    it('should include timestamp in filename', async () => {
      const executorOutput = new ExecutorOutput({
        bulletIds: [],
        finalAnswer: 'Test',
        hint: 'timing',
        reasoning: 'Test',
        toolUsage: [],
      })

      const filePath1 = await store.save(executorOutput, testDir)
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
      const filePath2 = await store.save(executorOutput, testDir)

      // Should have different filenames due to timestamp
      expect(filePath1).to.not.equal(filePath2)
    })
  })
})
