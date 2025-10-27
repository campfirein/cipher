import {expect} from 'chai'
import sinon, {stub} from 'sinon'

import type {IPlaybookStore} from '../../../../src/core/interfaces/i-playbook-store.js'

import {Playbook} from '../../../../src/core/domain/entities/playbook.js'
import {LoadPlaybookUseCase} from '../../../../src/core/usecases/load-playbook-use-case.js'

describe('LoadPlaybookUseCase', () => {
  let playbookStore: sinon.SinonStubbedInstance<IPlaybookStore>
  let useCase: LoadPlaybookUseCase

  beforeEach(() => {
    playbookStore = {
      clear: stub(),
      delete: stub(),
      exists: stub(),
      load: stub(),
      save: stub(),
    }

    useCase = new LoadPlaybookUseCase(playbookStore)
  })

  describe('execute', () => {
    it('should load playbook and generate prompt', async () => {
      const playbook = new Playbook()
      playbook.addBullet('Common Errors', 'Always validate inputs', undefined, {
        codebasePath: '/src',
        tags: ['validation'],
        timestamp: new Date().toISOString(),
      })

      playbookStore.load.resolves(playbook)

      const result = await useCase.execute()

      expect(result.success).to.be.true
      expect(result.playbook).to.equal(playbook)
      expect(result.playbookPrompt).to.be.a('string')
      expect(result.playbookPrompt).to.include('Common Errors')
      expect(result.playbookPrompt).to.include('Always validate inputs')
      expect(playbookStore.load.calledOnce).to.be.true
    })

    it('should return error when playbook not found', async () => {
      playbookStore.load.resolves()

      const result = await useCase.execute()

      expect(result.success).to.be.false
      expect(result.error).to.include('not found')
      expect(result.playbook).to.be.undefined
    })

    it('should load playbook without reflections by default', async () => {
      const playbook = new Playbook()
      playbookStore.load.resolves(playbook)

      const result = await useCase.execute()

      expect(result.success).to.be.true
      expect(result.recentReflections).to.be.undefined
    })

    it('should load recent reflections when requested', async () => {
      const playbook = new Playbook()
      playbookStore.load.resolves(playbook)

      const result = await useCase.execute(undefined, {
        includeReflections: true,
        reflectionCount: 3,
      })

      expect(result.success).to.be.true
      expect(result.recentReflections).to.be.an('array')
    })

    it('should handle empty playbook', async () => {
      const emptyPlaybook = new Playbook()
      playbookStore.load.resolves(emptyPlaybook)

      const result = await useCase.execute()

      expect(result.success).to.be.true
      expect(result.playbookPrompt).to.include('(Empty playbook)')
    })

    it('should accept custom directory parameter', async () => {
      const customDir = '/custom/path'
      const playbook = new Playbook()
      playbookStore.load.resolves(playbook)

      const result = await useCase.execute(customDir)

      expect(result.success).to.be.true
      expect(playbookStore.load.calledWith(customDir)).to.be.true
    })

    it('should handle playbook load errors', async () => {
      playbookStore.load.rejects(new Error('File read error'))

      const result = await useCase.execute()

      expect(result.success).to.be.false
      expect(result.error).to.include('File read error')
    })
  })
})
