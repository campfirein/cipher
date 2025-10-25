import {expect} from 'chai'

import type {IPlaybookStore} from '../../../../src/core/interfaces/i-playbook-store.js'

import {Playbook} from '../../../../src/core/domain/entities/playbook.js'
import {AddBulletUseCase} from '../../../../src/core/usecases/add-bullet-use-case.js'

describe('AddBulletUseCase', () => {
  let mockPlaybookStore: IPlaybookStore
  let useCase: AddBulletUseCase

  beforeEach(() => {
    // Create mock playbook store
    mockPlaybookStore = {
      delete() {
        return Promise.resolve()
      },
      exists() {
        return Promise.resolve(true)
      },
      load() {
        return Promise.resolve(new Playbook())
      },
      save() {
        return Promise.resolve()
      },
    }

    useCase = new AddBulletUseCase(mockPlaybookStore)
  })

  describe('ADD operation', () => {
    it('should add a new bullet when no bullet-id is provided', async () => {
      const result = await useCase.execute({
        content: 'Test bullet content',
        section: 'Test Section',
      })

      expect(result.success).to.be.true
      expect(result.operation).to.equal('ADD')
      expect(result.bullet).to.exist
      expect(result.bullet!.content).to.equal('Test bullet content')
      expect(result.bullet!.section).to.equal('Test Section')
      expect(result.bullet!.id).to.match(/^test-\d{5}$/) // Auto-generated ID
    })

    it('should create a new playbook if one does not exist', async () => {
      mockPlaybookStore.load = async () => new Playbook()

      const result = await useCase.execute({
        content: 'Test bullet content',
        section: 'Test Section',
      })

      expect(result.success).to.be.true
      expect(result.operation).to.equal('ADD')
      expect(result.playbook).to.exist
      expect(result.playbook!.getBullets()).to.have.lengthOf(1)
    })

    it('should add bullet with custom metadata', async () => {
      const customMetadata = {
        codebasePath: '/custom/path',
        tags: ['tag1', 'tag2'],
        timestamp: new Date().toISOString(),
      }

      const result = await useCase.execute({
        content: 'Test bullet with metadata',
        metadata: customMetadata,
        section: 'Test Section',
      })

      expect(result.success).to.be.true
      expect(result.bullet!.metadata.tags).to.deep.equal(['tag1', 'tag2'])
      expect(result.bullet!.metadata.codebasePath).to.equal('/custom/path')
    })
  })

  describe('UPDATE operation', () => {
    it('should update an existing bullet when bullet-id is provided', async () => {
      // Create playbook with existing bullet
      const playbook = new Playbook()
      const existingBullet = playbook.addBullet('Test Section', 'Original content', undefined, {
        codebasePath: '/test',
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      mockPlaybookStore.load = async () => playbook

      const result = await useCase.execute({
        bulletId: existingBullet.id,
        content: 'Updated content',
        section: 'Test Section',
      })

      expect(result.success).to.be.true
      expect(result.operation).to.equal('UPDATE')
      expect(result.bullet).to.exist
      expect(result.bullet!.id).to.equal(existingBullet.id)
      expect(result.bullet!.content).to.equal('Updated content')
    })

    it('should return error when updating non-existent bullet-id', async () => {
      const result = await useCase.execute({
        bulletId: 'non-existent-id',
        content: 'Updated content',
        section: 'Test Section',
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('not found')
    })

    it('should update bullet metadata', async () => {
      const playbook = new Playbook()
      const existingBullet = playbook.addBullet('Test Section', 'Original content', undefined, {
        codebasePath: '/test',
        tags: ['original'],
        timestamp: new Date().toISOString(),
      })

      mockPlaybookStore.load = async () => playbook

      const newMetadata = {
        codebasePath: '/new/path',
        tags: ['updated-tag'],
        timestamp: new Date().toISOString(),
      }

      const result = await useCase.execute({
        bulletId: existingBullet.id,
        content: 'Updated content',
        metadata: newMetadata,
        section: 'Test Section',
      })

      expect(result.success).to.be.true
      expect(result.bullet!.metadata.tags).to.deep.equal(['updated-tag'])
      expect(result.bullet!.metadata.codebasePath).to.equal('/new/path')
    })
  })

  describe('Validation', () => {
    it('should return error when section is empty', async () => {
      const result = await useCase.execute({
        content: 'Test content',
        section: '',
      })

      expect(result.success).to.be.false
      expect(result.error).to.equal('Section is required')
    })

    it('should return error when content is empty', async () => {
      const result = await useCase.execute({
        content: '',
        section: 'Test Section',
      })

      expect(result.success).to.be.false
      expect(result.error).to.equal('Content is required')
    })

    it('should return error when section is only whitespace', async () => {
      const result = await useCase.execute({
        content: 'Test content',
        section: '   ',
      })

      expect(result.success).to.be.false
      expect(result.error).to.equal('Section is required')
    })

    it('should return error when content is only whitespace', async () => {
      const result = await useCase.execute({
        content: '   ',
        section: 'Test Section',
      })

      expect(result.success).to.be.false
      expect(result.error).to.equal('Content is required')
    })
  })

  describe('Playbook persistence', () => {
    it('should save the playbook after adding a bullet', async () => {
      let savedPlaybook: Playbook | undefined

      mockPlaybookStore.save = async (playbook: Playbook) => {
        savedPlaybook = playbook
      }

      await useCase.execute({
        content: 'Test bullet content',
        section: 'Test Section',
      })

      expect(savedPlaybook).to.exist
      expect(savedPlaybook!.getBullets()).to.have.lengthOf(1)
    })

    it('should save the playbook after updating a bullet', async () => {
      const playbook = new Playbook()
      const existingBullet = playbook.addBullet('Test Section', 'Original content', undefined, {
        codebasePath: '/test',
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      mockPlaybookStore.load = async () => playbook

      let savedPlaybook: Playbook | undefined
      mockPlaybookStore.save = async (p: Playbook) => {
        savedPlaybook = p
      }

      await useCase.execute({
        bulletId: existingBullet.id,
        content: 'Updated content',
        section: 'Test Section',
      })

      expect(savedPlaybook).to.exist
      expect(savedPlaybook!.getBullet(existingBullet.id)!.content).to.equal('Updated content')
    })
  })

  describe('Error handling', () => {
    it('should handle playbook store load errors', async () => {
      mockPlaybookStore.load = async () => {
        throw new Error('Storage error')
      }

      const result = await useCase.execute({
        content: 'Test content',
        section: 'Test Section',
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('Storage error')
    })

    it('should handle playbook store save errors', async () => {
      mockPlaybookStore.save = async () => {
        throw new Error('Save failed')
      }

      const result = await useCase.execute({
        content: 'Test content',
        section: 'Test Section',
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('Save failed')
    })
  })
})
