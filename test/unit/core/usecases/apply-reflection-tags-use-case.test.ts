import {expect} from 'chai'
import sinon, {match, stub} from 'sinon'

import type {IPlaybookStore} from '../../../../src/core/interfaces/i-playbook-store.js'

import {Playbook} from '../../../../src/core/domain/entities/playbook.js'
import {ReflectorOutput} from '../../../../src/core/domain/entities/reflector-output.js'
import {ApplyReflectionTagsUseCase} from '../../../../src/core/usecases/apply-reflection-tags-use-case.js'

describe('ApplyReflectionTagsUseCase', () => {
  let playbookStore: sinon.SinonStubbedInstance<IPlaybookStore>
  let useCase: ApplyReflectionTagsUseCase

  beforeEach(() => {
    playbookStore = {
      delete: stub(),
      exists: stub(),
      load: stub(),
      save: stub(),
    }

    useCase = new ApplyReflectionTagsUseCase(playbookStore)
  })

  describe('execute', () => {
    it('should apply tags from reflection to bullets', async () => {
      const playbook = new Playbook()
      playbook.addBullet('Common Errors', 'Validation error', 'error-00001', {
        relatedFiles: [],
        tags: ['validation'],
        timestamp: new Date().toISOString(),
      })
      playbook.addBullet('Best Practices', 'Use DI pattern', 'practices-00001', {
        relatedFiles: [],
        tags: ['architecture'],
        timestamp: new Date().toISOString(),
      })

      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const reflection = new ReflectorOutput({
        bulletTags: [
          {id: 'error-00001', tag: 'helpful'},
          {id: 'practices-00001', tag: 'helpful'},
        ],
        correctApproach: 'Add input validation layer',
        errorIdentification: 'Input validation was missing',
        hint: 'test-hint',
        keyInsight: 'Always validate inputs',
        reasoning: 'Analysis reasoning',
        rootCauseAnalysis: 'No validation framework',
      })

      const result = await useCase.execute(reflection)

      expect(result.success).to.be.true
      expect(result.tagsApplied).to.equal(2)
      expect(playbookStore.save.calledOnce).to.be.true

      const updatedBullet = result.playbook!.getBullet('error-00001')
      expect(updatedBullet!.metadata.tags).to.include('helpful')
    })

    it('should skip non-existent bullets', async () => {
      const playbook = new Playbook()
      playbook.addBullet('Common Errors', 'Validation error', 'error-00001', {
        relatedFiles: [],
        tags: ['validation'],
        timestamp: new Date().toISOString(),
      })

      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const reflection = new ReflectorOutput({
        bulletTags: [
          {id: 'error-00001', tag: 'helpful'},
          {id: 'non-existent-00999', tag: 'helpful'}, // This should be skipped
        ],
        correctApproach: 'Correct approach',
        errorIdentification: 'Error',
        hint: 'test-hint',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })

      const result = await useCase.execute(reflection)

      expect(result.success).to.be.true
      expect(result.tagsApplied).to.equal(1) // Only 1 tag applied
    })

    it('should return error when playbook not found', async () => {
      playbookStore.load.resolves()

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Correct approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })

      const result = await useCase.execute(reflection)

      expect(result.success).to.be.false
      expect(result.error).to.include('not found')
      expect(playbookStore.save.called).to.be.false
    })

    it('should handle empty bullet tags', async () => {
      const playbook = new Playbook()
      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const reflection = new ReflectorOutput({
        bulletTags: [], // No tags to apply
        correctApproach: 'Correct approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })

      const result = await useCase.execute(reflection)

      expect(result.success).to.be.true
      expect(result.tagsApplied).to.equal(0)
      expect(playbookStore.save.calledOnce).to.be.true
    })

    it('should not duplicate existing tags', async () => {
      const playbook = new Playbook()
      playbook.addBullet('Common Errors', 'Error', 'error-00001', {
        relatedFiles: [],
        tags: ['helpful'], // Already has 'helpful' tag
        timestamp: new Date().toISOString(),
      })

      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const reflection = new ReflectorOutput({
        bulletTags: [{id: 'error-00001', tag: 'helpful'}], // Trying to add duplicate tag
        correctApproach: 'Correct approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })

      const result = await useCase.execute(reflection)

      expect(result.success).to.be.true
      const bullet = result.playbook!.getBullet('error-00001')
      const helpfulCount = bullet!.metadata.tags.filter((t) => t === 'helpful').length
      expect(helpfulCount).to.equal(1) // Should still be 1, not 2
    })

    it('should accept custom directory parameter', async () => {
      const customDir = '/custom/path'
      const playbook = new Playbook()
      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Correct approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })

      await useCase.execute(reflection, customDir)

      expect(playbookStore.load.calledWith(customDir)).to.be.true
      expect(playbookStore.save.calledWith(match.any, customDir)).to.be.true
    })

    it('should handle save errors', async () => {
      const playbook = new Playbook()
      playbookStore.load.resolves(playbook)
      playbookStore.save.rejects(new Error('Disk full'))

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Correct approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })

      const result = await useCase.execute(reflection)

      expect(result.success).to.be.false
      expect(result.error).to.include('Disk full')
    })
  })
})
