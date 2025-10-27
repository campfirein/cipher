import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {IPlaybookStore} from '../../src/core/interfaces/i-playbook-store.js'

import Add from '../../src/commands/add.js'
import {Playbook} from '../../src/core/domain/entities/playbook.js'

/**
 * Testable Add command that accepts mocked services
 */
class TestableAdd extends Add {
  constructor(
    private readonly mockPlaybookStore: IPlaybookStore,
    argv: string[],
    config: Config,
  ) {
    super(argv, config)
  }

  protected createServices() {
    return {
      playbookStore: this.mockPlaybookStore,
    }
  }
}

describe('Add Command', () => {
  let config: Config
  let playbookStore: sinon.SinonStubbedInstance<IPlaybookStore>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    playbookStore = {
      clear: stub(),
      delete: stub(),
      exists: stub(),
      load: stub(),
      save: stub(),
    }
  })

  afterEach(() => {
    restore()
  })

  describe('ADD operation', () => {
    it('should add a new bullet when no bullet-id is provided', async () => {
      playbookStore.load.resolves(new Playbook())
      playbookStore.save.resolves()

      const command = new TestableAdd(
        playbookStore,
        ['--section', 'Test Section', '--content', 'Test content'],
        config,
      )

      await command.run()

      // Verify save was called
      expect(playbookStore.save.calledOnce).to.be.true

      // Verify playbook has the new bullet
      const savedPlaybook = playbookStore.save.firstCall.args[0] as Playbook
      expect(savedPlaybook.getBullets()).to.have.lengthOf(1)

      const bullet = savedPlaybook.getBullets()[0]
      expect(bullet.section).to.equal('Test Section')
      expect(bullet.content).to.equal('Test content')
    })

    it('should create a new playbook if none exists', async () => {
      playbookStore.load.resolves()
      playbookStore.save.resolves()

      const command = new TestableAdd(
        playbookStore,
        ['--section', 'New Section', '--content', 'New content'],
        config,
      )

      await command.run()

      expect(playbookStore.save.calledOnce).to.be.true

      const savedPlaybook = playbookStore.save.firstCall.args[0] as Playbook
      expect(savedPlaybook.getBullets()).to.have.lengthOf(1)
    })

    it('should accept short flags', async () => {
      playbookStore.load.resolves(new Playbook())
      playbookStore.save.resolves()

      const command = new TestableAdd(playbookStore, ['-s', 'Test', '-c', 'Content'], config)

      await command.run()

      expect(playbookStore.save.calledOnce).to.be.true
    })
  })

  describe('UPDATE operation', () => {
    it('should update an existing bullet when bullet-id is provided', async () => {
      const playbook = new Playbook()
      const existingBullet = playbook.addBullet('Original Section', 'Original content', undefined, {
        codebasePath: '/test',
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const command = new TestableAdd(
        playbookStore,
        [
          '--section',
          'Original Section',
          '--content',
          'Updated content',
          '--bullet-id',
          existingBullet.id,
        ],
        config,
      )

      await command.run()

      const savedPlaybook = playbookStore.save.firstCall.args[0] as Playbook
      const updatedBullet = savedPlaybook.getBullet(existingBullet.id)

      expect(updatedBullet).to.exist
      expect(updatedBullet!.content).to.equal('Updated content')
    })

    it('should accept short flag for bullet-id', async () => {
      const playbook = new Playbook()
      const existingBullet = playbook.addBullet('Test Section', 'Original content', undefined, {
        codebasePath: '/test',
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const command = new TestableAdd(
        playbookStore,
        ['-s', 'Test Section', '-c', 'Updated', '-b', existingBullet.id],
        config,
      )

      await command.run()

      const savedPlaybook = playbookStore.save.firstCall.args[0] as Playbook
      const updatedBullet = savedPlaybook.getBullet(existingBullet.id)

      expect(updatedBullet!.content).to.equal('Updated')
    })

    it('should throw error when updating non-existent bullet-id', async () => {
      playbookStore.load.resolves(new Playbook())

      const command = new TestableAdd(
        playbookStore,
        ['--section', 'Test', '--content', 'Content', '--bullet-id', 'non-existent'],
        config,
      )

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('not found')
      }
    })
  })

  describe('Flag validation', () => {
    it('should require section flag', async () => {
      const command = new TestableAdd(playbookStore, ['--content', 'Test content'], config)

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        // oclif validation error
      }
    })

    it('should require content flag', async () => {
      const command = new TestableAdd(playbookStore, ['--section', 'Test Section'], config)

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        // oclif validation error
      }
    })
  })

  describe('Error handling', () => {
    it('should handle playbook store errors gracefully', async () => {
      playbookStore.load.rejects(new Error('Storage failure'))

      const command = new TestableAdd(
        playbookStore,
        ['--section', 'Test', '--content', 'Content'],
        config,
      )

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Storage failure')
      }
    })

    it('should handle save errors gracefully', async () => {
      playbookStore.load.resolves(new Playbook())
      playbookStore.save.rejects(new Error('Save failed'))

      const command = new TestableAdd(
        playbookStore,
        ['--section', 'Test', '--content', 'Content'],
        config,
      )

      try {
        await command.run()
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Save failed')
      }
    })
  })

  describe('Output formatting', () => {
    it('should display bullet details after successful add', async () => {
      playbookStore.load.resolves(new Playbook())
      playbookStore.save.resolves()

      const logStub = stub(Add.prototype, 'log')

      const command = new TestableAdd(
        playbookStore,
        ['--section', 'Test Section', '--content', 'Test content'],
        config,
      )

      await command.run()

      // Verify success message and bullet details are logged
      expect(logStub.called).to.be.true
      const logMessages = logStub.getCalls().map((call) => call.args[0] as string)

      expect(logMessages.some((msg) => msg.includes('Added bullet successfully'))).to.be.true
      expect(logMessages.some((msg) => msg.includes('Test Section'))).to.be.true
      expect(logMessages.some((msg) => msg.includes('Test content'))).to.be.true

      logStub.restore()
    })

    it('should display "Updated" for update operations', async () => {
      const playbook = new Playbook()
      const existingBullet = playbook.addBullet('Test Section', 'Original', undefined, {
        codebasePath: '/test',
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      playbookStore.load.resolves(playbook)
      playbookStore.save.resolves()

      const logStub = stub(Add.prototype, 'log')

      const command = new TestableAdd(
        playbookStore,
        ['-s', 'Test Section', '-c', 'Updated', '-b', existingBullet.id],
        config,
      )

      await command.run()

      const logMessages = logStub.getCalls().map((call) => call.args[0] as string)
      expect(logMessages.some((msg) => msg.includes('Updated bullet successfully'))).to.be.true

      logStub.restore()
    })
  })
})
