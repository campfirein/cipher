import {expect} from 'chai'
import {readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {DeltaBatch} from '../../../../src/core/domain/entities/delta-batch.js'
import {DeltaOperation} from '../../../../src/core/domain/entities/delta-operation.js'
import {FileDeltaStore} from '../../../../src/infra/ace/file-delta-store.js'

describe('FileDeltaStore', () => {
  let store: FileDeltaStore
  let testDir: string

  beforeEach(() => {
    store = new FileDeltaStore()
    // Use temp directory for testing
    testDir = join(tmpdir(), `byterover-test-${Date.now()}`)
  })

  describe('save', () => {
    it('should save delta batch to file with hint', async () => {
      const operation = new DeltaOperation('ADD', 'Test Section', {
        content: 'Test bullet',
        metadata: {
          relatedFiles: [],
          tags: ['test'],
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      })
      const deltaBatch = new DeltaBatch('Test reasoning', [operation])

      const filePath = await store.save(deltaBatch, 'test-hint', testDir)

      // Verify file path structure
      expect(filePath).to.include('.br/ace/deltas')
      expect(filePath).to.include('delta-test-hint-')
      expect(filePath).to.include('.json')

      // Verify file contents
      const content = await readFile(filePath, 'utf8')
      const saved = JSON.parse(content)

      expect(saved.reasoning).to.equal('Test reasoning')
      expect(saved.operations).to.have.lengthOf(1)
      expect(saved.operations[0].content).to.equal('Test bullet')
    })

    it('should save delta batch without hint', async () => {
      const deltaBatch = new DeltaBatch('Empty delta', [])

      const filePath = await store.save(deltaBatch, undefined, testDir)

      // Verify filename pattern without hint
      expect(filePath).to.include('.br/ace/deltas/delta-')
      expect(filePath).to.not.include('delta--')
      expect(filePath).to.include('.json')

      // Verify file contents
      const content = await readFile(filePath, 'utf8')
      const saved = JSON.parse(content)

      expect(saved.reasoning).to.equal('Empty delta')
      expect(saved.operations).to.be.an('array').that.is.empty
    })

    it('should create directory if it does not exist', async () => {
      const deltaBatch = new DeltaBatch('Test', [])

      // Should not throw when directory doesn't exist
      const filePath = await store.save(deltaBatch, 'auto-create', testDir)

      expect(filePath).to.exist
      const content = await readFile(filePath, 'utf8')
      expect(content).to.exist
    })

    it('should include timestamp in filename', async () => {
      const deltaBatch = new DeltaBatch('Test', [])

      const filePath1 = await store.save(deltaBatch, 'timing', testDir)
      // Small delay to ensure different timestamps
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
      const filePath2 = await store.save(deltaBatch, 'timing', testDir)

      // Should have different filenames due to timestamp
      expect(filePath1).to.not.equal(filePath2)
    })
  })
})
