import {expect} from 'chai'
import sinon, {match, stub} from 'sinon'

import type {IPlaybookStore} from '../../../../src/core/interfaces/i-playbook-store.js'

import {DeltaBatch} from '../../../../src/core/domain/entities/delta-batch.js'
import {DeltaOperation} from '../../../../src/core/domain/entities/delta-operation.js'
import {Playbook} from '../../../../src/core/domain/entities/playbook.js'
import {ApplyDeltaUseCase} from '../../../../src/core/usecases/apply-delta-use-case.js'

describe('ApplyDeltaUseCase', () => {
  let playbookStore: sinon.SinonStubbedInstance<IPlaybookStore>
  let useCase: ApplyDeltaUseCase

  beforeEach(() => {
    playbookStore = {
      clear: stub(),
      delete: stub(),
      exists: stub(),
      load: stub(),
      save: stub(),
    }

    useCase = new ApplyDeltaUseCase(playbookStore)
  })

  afterEach(() => {
    // Reset all stub call counts
    playbookStore.clear.reset()
    playbookStore.delete.reset()
    playbookStore.exists.reset()
    playbookStore.load.reset()
    playbookStore.save.reset()
  })

  describe('execute', () => {
    it('should apply ADD operation to existing playbook', async () => {
      const playbook = new Playbook()
      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const addOp = new DeltaOperation('ADD', 'Common Errors', {
        content: 'Always validate user inputs',
        metadata: {
          codebasePath: '/src',
          tags: ['validation'],
          timestamp: new Date().toISOString(),
        },
      })
      const delta = new DeltaBatch('Adding validation reminder', [addOp])

      const result = await useCase.execute(delta)

      expect(result.success).to.be.true
      expect(result.operationsApplied).to.equal(1)
      expect(result.playbook).to.exist
      expect(result.playbook!.getBullets()).to.have.lengthOf(1)
      expect(playbookStore.save.calledOnce).to.be.true
    })

    it('should apply UPDATE operation to existing bullet', async () => {
      const playbook = new Playbook()
      playbook.addBullet('Common Errors', 'Old content', 'error-00001', {
        codebasePath: '/src',
        tags: ['old'],
        timestamp: new Date().toISOString(),
      })

      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const updateOp = new DeltaOperation('UPDATE', 'Common Errors', {
        bulletId: 'error-00001',
        content: 'Updated content',
      })
      const delta = new DeltaBatch('Updating error description', [updateOp])

      const result = await useCase.execute(delta)

      expect(result.success).to.be.true
      expect(result.operationsApplied).to.equal(1)

      const updatedBullet = result.playbook!.getBullet('error-00001')
      expect(updatedBullet).to.exist
      expect(updatedBullet!.content).to.equal('Updated content')
    })

    it('should apply REMOVE operation', async () => {
      const playbook = new Playbook()
      playbook.addBullet('Common Errors', 'To be removed', 'error-00001', {
        codebasePath: '/src',
        tags: ['old'],
        timestamp: new Date().toISOString(),
      })

      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const removeOp = new DeltaOperation('REMOVE', 'Common Errors', {
        bulletId: 'error-00001',
      })
      const delta = new DeltaBatch('Removing outdated entry', [removeOp])

      const result = await useCase.execute(delta)

      expect(result.success).to.be.true
      expect(result.operationsApplied).to.equal(1)
      expect(result.playbook!.getBullets()).to.have.lengthOf(0)
    })

    it('should apply multiple operations in batch', async () => {
      const playbook = new Playbook()
      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const ops = [
        new DeltaOperation('ADD', 'Common Errors', {
          content: 'Error 1',
          metadata: {
            codebasePath: '/src',
            tags: ['error'],
            timestamp: new Date().toISOString(),
          },
        }),
        new DeltaOperation('ADD', 'Best Practices', {
          content: 'Practice 1',
          metadata: {
            codebasePath: '/src',
            tags: ['best-practice'],
            timestamp: new Date().toISOString(),
          },
        }),
      ]
      const delta = new DeltaBatch('Adding multiple entries', ops)

      const result = await useCase.execute(delta)

      expect(result.success).to.be.true
      expect(result.operationsApplied).to.equal(2)
      expect(result.playbook!.getBullets()).to.have.lengthOf(2)
    })

    it('should create new playbook if none exists', async () => {
      playbookStore.load.resolves()
      playbookStore.save.resolves()

      const addOp = new DeltaOperation('ADD', 'Common Errors', {
        content: 'First bullet',
        metadata: {
          codebasePath: '/src',
          tags: ['first'],
          timestamp: new Date().toISOString(),
        },
      })
      const delta = new DeltaBatch('Creating first entry', [addOp])

      const result = await useCase.execute(delta)

      expect(result.success).to.be.true
      expect(result.playbook).to.exist
      expect(result.playbook!.getBullets()).to.have.lengthOf(1)
    })

    it('should handle save errors', async () => {
      const playbook = new Playbook()
      playbookStore.load.resolves(playbook)
      playbookStore.save.rejects(new Error('Disk full'))

      const addOp = new DeltaOperation('ADD', 'Common Errors', {
        content: 'Test',
        metadata: {
          codebasePath: '/src',
          tags: ['test'],
          timestamp: new Date().toISOString(),
        },
      })
      const delta = new DeltaBatch('Test operation', [addOp])

      const result = await useCase.execute(delta)

      expect(result.success).to.be.false
      expect(result.error).to.include('Disk full')
    })

    it('should accept custom directory parameter', async () => {
      const customDir = '/custom/path'
      const playbook = new Playbook()
      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const addOp = new DeltaOperation('ADD', 'Common Errors', {
        content: 'Test',
        metadata: {
          codebasePath: '/src',
          tags: ['test'],
          timestamp: new Date().toISOString(),
        },
      })
      const delta = new DeltaBatch('Test', [addOp])

      await useCase.execute(delta, customDir)

      expect(playbookStore.load.calledWith(customDir)).to.be.true
      expect(playbookStore.save.calledWith(match.any, customDir)).to.be.true
    })
  })
})
