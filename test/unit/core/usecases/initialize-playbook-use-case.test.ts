import {expect} from 'chai'
import {rm} from 'node:fs/promises'
import {join} from 'node:path'
import sinon, {restore, stub} from 'sinon'

import type {IPlaybookStore} from '../../../../src/core/interfaces/i-playbook-store.js'

import {InitializePlaybookUseCase} from '../../../../src/core/usecases/initialize-playbook-use-case.js'

describe('InitializePlaybookUseCase', () => {
  let playbookStore: sinon.SinonStubbedInstance<IPlaybookStore>
  let useCase: InitializePlaybookUseCase

  beforeEach(() => {
    playbookStore = {
      delete: stub(),
      exists: stub(),
      load: stub(),
      save: stub(),
    }

    useCase = new InitializePlaybookUseCase(playbookStore)
  })

  afterEach(async () => {
    restore()
    // Clean up test artifacts in project root
    await rm(join(process.cwd(), '.br'), {force: true, recursive: true})
    // Clean up test artifacts in custom test directory
    await rm('/tmp/test-br-cli', {force: true, recursive: true})
  })

  describe('execute', () => {
    it('should create ACE directory structure and empty playbook', async () => {
      playbookStore.exists.resolves(false)
      playbookStore.save.resolves()

      const result = await useCase.execute()

      expect(result.success).to.be.true
      expect(result.playbookPath).to.include('.br/ace/playbook.json')
      expect(playbookStore.exists.calledOnce).to.be.true
      expect(playbookStore.save.calledOnce).to.be.true

      // Verify empty playbook was saved
      const savedPlaybook = playbookStore.save.firstCall.args[0]
      expect(savedPlaybook).to.exist
      expect(savedPlaybook.getBullets()).to.have.lengthOf(0)
    })

    it('should fail if playbook already exists', async () => {
      playbookStore.exists.resolves(true)

      const result = await useCase.execute()

      expect(result.success).to.be.false
      expect(result.error).to.include('already exists')
    })

    it('should handle directory creation errors', async () => {
      playbookStore.exists.resolves(false)
      playbookStore.save.rejects(new Error('Permission denied'))

      const result = await useCase.execute()

      expect(result.success).to.be.false
      expect(result.error).to.include('Permission denied')
    })

    it('should accept custom directory parameter', async () => {
      const customDir = '/tmp/test-br-cli'
      playbookStore.exists.resolves(false)
      playbookStore.save.resolves()

      const result = await useCase.execute(customDir)

      // Main assertion - should succeed
      expect(result.success).to.be.true
      expect(result.playbookPath).to.include(customDir)
    })
  })
})
