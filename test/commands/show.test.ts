import {Config} from '@oclif/core'
import {expect} from 'chai'
import sinon, {createSandbox} from 'sinon'

import type {IPlaybookStore} from '../../src/core/interfaces/i-playbook-store.js'

import Show from '../../src/commands/show.js'
import {Playbook} from '../../src/core/domain/entities/playbook.js'

/**
 * Testable Show command that accepts mocked services
 */
class TestableShow extends Show {
  private readonly mockPlaybookStore: IPlaybookStore

  constructor(mockPlaybookStore: IPlaybookStore, args: string[], config: Config) {
    super(args, config)
    this.mockPlaybookStore = mockPlaybookStore
  }

  protected createServices() {
    return {
      playbookStore: this.mockPlaybookStore,
    }
  }
}

describe('show command', () => {
  let sandbox: sinon.SinonSandbox
  let config: Config
  let playbookStore: sinon.SinonStubbedInstance<IPlaybookStore>

  beforeEach(async () => {
    sandbox = createSandbox()
    config = await Config.load()

    playbookStore = {
      clear: sandbox.stub(),
      delete: sandbox.stub(),
      exists: sandbox.stub(),
      load: sandbox.stub(),
      save: sandbox.stub(),
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('markdown format (default)', () => {
    it('should display playbook content in markdown format', async () => {
      const playbook = new Playbook()
      const metadata = {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      }
      playbook.addBullet('Section 1', 'First bullet', undefined, metadata)
      playbook.addBullet('Section 1', 'Second bullet', undefined, metadata)
      playbook.addBullet('Section 2', 'Third bullet', undefined, metadata)

      playbookStore.load.resolves(playbook)

      const command = new TestableShow(playbookStore, [], config)
      const logStub = sandbox.stub(command, 'log')

      await command.run()

      expect(playbookStore.load.called).to.be.true
      expect(logStub.calledWith('# ACE Playbook\n')).to.be.true
      // Verify asPrompt() was logged
      expect(logStub.callCount).to.equal(2) // Header + content
    })

    it('should display empty playbook message for empty playbook', async () => {
      const emptyPlaybook = new Playbook()

      playbookStore.load.resolves(emptyPlaybook)

      const command = new TestableShow(playbookStore, [], config)
      const logStub = sandbox.stub(command, 'log')

      await command.run()

      expect(playbookStore.load.called).to.be.true
      expect(logStub.calledWith('Playbook is empty. Use ACE commands to add knowledge.')).to.be.true
    })
  })

  describe('json format', () => {
    it('should display playbook content in JSON format with --format json', async () => {
      const playbook = new Playbook()
      const metadata = {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      }
      playbook.addBullet('Section 1', 'First bullet', undefined, metadata)

      playbookStore.load.resolves(playbook)

      const command = new TestableShow(playbookStore, ['--format', 'json'], config)
      const logStub = sandbox.stub(command, 'log')

      await command.run()

      expect(playbookStore.load.called).to.be.true
      expect(logStub.callCount).to.equal(1)
      // Verify JSON was logged
      const loggedContent = logStub.firstCall.args[0]
      expect(loggedContent).to.be.a('string')
      const parsed = JSON.parse(loggedContent as string)
      expect(parsed).to.have.property('bullets')
      expect(parsed).to.have.property('sections')
      expect(parsed).to.have.property('nextId')
    })

    it('should display empty playbook in JSON format', async () => {
      const emptyPlaybook = new Playbook()

      playbookStore.load.resolves(emptyPlaybook)

      const command = new TestableShow(playbookStore, ['--format', 'json'], config)
      const logStub = sandbox.stub(command, 'log')

      await command.run()

      expect(playbookStore.load.called).to.be.true
      expect(logStub.callCount).to.equal(1)
      // Verify JSON structure
      const loggedContent = logStub.firstCall.args[0]
      const parsed = JSON.parse(loggedContent as string)
      expect(parsed.bullets).to.deep.equal({})
      expect(parsed.sections).to.deep.equal({})
    })

    it('should use short flag -f for format', async () => {
      const playbook = new Playbook()
      const metadata = {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      }
      playbook.addBullet('Test', 'Content', undefined, metadata)

      playbookStore.load.resolves(playbook)

      const command = new TestableShow(playbookStore, ['-f', 'json'], config)
      sandbox.stub(command, 'log')

      await command.run()

      expect(playbookStore.load.called).to.be.true
    })
  })

  describe('custom directory', () => {
    it('should pass custom directory to playbook store', async () => {
      const playbook = new Playbook()
      const metadata = {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      }
      playbook.addBullet('Test', 'Content', undefined, metadata)

      playbookStore.load.resolves(playbook)

      const command = new TestableShow(playbookStore, ['/custom/path'], config)
      sandbox.stub(command, 'log')

      await command.run()

      expect(playbookStore.load.calledWith('/custom/path')).to.be.true
    })

    it('should work with custom directory and format flag together', async () => {
      const playbook = new Playbook()
      const metadata = {
        relatedFiles: [],
        tags: ['test'],
        timestamp: new Date().toISOString(),
      }
      playbook.addBullet('Test', 'Content', undefined, metadata)

      playbookStore.load.resolves(playbook)

      const command = new TestableShow(playbookStore, ['/custom/path', '--format', 'json'], config)
      sandbox.stub(command, 'log')

      await command.run()

      expect(playbookStore.load.calledWith('/custom/path')).to.be.true
    })
  })

  describe('error handling', () => {
    it('should handle playbook not found (null)', async () => {
      playbookStore.load.resolves()

      const command = new TestableShow(playbookStore, [], config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Playbook not found')
      }
    })

    it('should handle playbook not found (undefined)', async () => {
      playbookStore.load.resolves()

      const command = new TestableShow(playbookStore, [], config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Playbook not found')
      }
    })

    it('should handle playbook store load errors', async () => {
      playbookStore.load.rejects(new Error('File system error'))

      const command = new TestableShow(playbookStore, [], config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('File system error')
      }
    })

    it('should handle generic errors with custom message', async () => {
      // Reject with a non-Error object to trigger the fallback message
      playbookStore.load.rejects({code: 'UNKNOWN'})

      const command = new TestableShow(playbookStore, [], config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to display playbook')
      }
    })
  })
})
