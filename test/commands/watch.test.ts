import {Config} from '@oclif/core'
import {expect} from 'chai'
import {restore, SinonStubbedInstance, stub} from 'sinon'

import type {IFileWatcherService} from '../../src/core/interfaces/i-file-watcher-service.js'
import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'

import Watch from '../../src/commands/watch.js'

class TestableWatch extends Watch {
  private readonly mockFileWatcherService: IFileWatcherService
  private readonly mockProjectConfigStore: IProjectConfigStore

  public constructor(mockFileWatcherService: IFileWatcherService, mockProjectConfigStore: IProjectConfigStore, argv: string[], config: Config) {
    super(argv, config)
    this.mockFileWatcherService = mockFileWatcherService
    this.mockProjectConfigStore = mockProjectConfigStore
  }

  protected createServices(): {
    fileWatcherService: IFileWatcherService
    projectConfigStore: IProjectConfigStore
  } {
    return {
      fileWatcherService: this.mockFileWatcherService,
      projectConfigStore: this.mockProjectConfigStore,
    }
  }

  public error(input: Error | string): never {
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(): void {}

  protected async waitForShutdownSignal(): Promise<void> {}

  public warn(input: Error | string): Error | string {
    return input
  }
}

describe('watch command', () => {
  let config: Config
  let fileWatcherService: SinonStubbedInstance<IFileWatcherService>
  let projectConfigStore: SinonStubbedInstance<IProjectConfigStore>

  before(async () => {
    config = await Config.load(import.meta.url)
  })

  beforeEach(() => {
    fileWatcherService = {
      setFileEventHandler: stub(),
      start: stub(),
      stop: stub(),
    }

    projectConfigStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }
  })

  afterEach(() => {
    restore()
  })

  describe('Path parsing', () => {
    it('should parse single path correctly', async () => {
      fileWatcherService.start.resolves()
      fileWatcherService.stop.resolves()

      const command = new TestableWatch(fileWatcherService, projectConfigStore, ['--paths', './test-folder'], config)
      await command.run()

      expect(fileWatcherService.start.calledOnce).to.be.true
      expect(fileWatcherService.start.calledWith(['./test-folder'])).to.be.true
    })

    it('should parse multiple comma-separated paths correctly', async () => {
      fileWatcherService.start.resolves()
      fileWatcherService.stop.resolves()

      const command = new TestableWatch(fileWatcherService, projectConfigStore, ['--paths', './logs,./outputs,./workspace'], config)
      await command.run()

      expect(fileWatcherService.start.calledOnce).to.be.true
      expect(fileWatcherService.start.calledWith(['./logs', './outputs', './workspace'])).to.be.true
    })

    it('should trim whitespace from paths', async () => {
      fileWatcherService.start.resolves()
      fileWatcherService.stop.resolves()

      const command = new TestableWatch(fileWatcherService, projectConfigStore, ['--paths', ' ./logs , ./outputs , ./workspace '], config)
      await command.run()

      expect(fileWatcherService.start.calledOnce).to.be.true
      expect(fileWatcherService.start.calledWith(['./logs', './outputs', './workspace'])).to.be.true
    })

    it('should use short flag -p', async () => {
      fileWatcherService.start.resolves()
      fileWatcherService.stop.resolves()

      const command = new TestableWatch(fileWatcherService, projectConfigStore, ['-p', './test'], config)
      await command.run()

      expect(fileWatcherService.start.calledOnce).to.be.true
      expect(fileWatcherService.start.calledWith(['./test'])).to.be.true
    })
  })

  describe('Service lifecycle', () => {
    it('should register event handler before starting', async () => {
      fileWatcherService.start.resolves()
      fileWatcherService.stop.resolves()

      const command = new TestableWatch(fileWatcherService, projectConfigStore, ['--paths', './test'], config)
      await command.run()

      expect(fileWatcherService.setFileEventHandler.calledOnce).to.be.true
      expect(fileWatcherService.setFileEventHandler.calledBefore(fileWatcherService.start)).to.be.true
    })

    it('should start the watcher service', async () => {
      fileWatcherService.start.resolves()
      fileWatcherService.stop.resolves()

      const command = new TestableWatch(fileWatcherService, projectConfigStore, ['--paths', './test'], config)
      await command.run()

      expect(fileWatcherService.start.calledOnce).to.be.true
    })

    it('should stop the watcher service in finally block', async () => {
      fileWatcherService.start.resolves()
      fileWatcherService.stop.resolves()

      const command = new TestableWatch(fileWatcherService, projectConfigStore, ['--paths', './test'], config)
      await command.run()

      expect(fileWatcherService.stop.calledOnce).to.be.true
    })

    it('should stop the watcher even if start throws error', async () => {
      fileWatcherService.start.rejects(new Error('Start failed'))
      fileWatcherService.stop.resolves()

      const command = new TestableWatch(fileWatcherService, projectConfigStore, ['--paths', './test'], config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.equal('Start failed')
      }

      // Stop should still be called
      expect(fileWatcherService.stop.calledOnce).to.be.true
    })
  })

  describe('Error handling', () => {
    it('should throw error if paths flag is missing', async () => {
      const command = new TestableWatch(fileWatcherService, projectConfigStore, [], config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        // oclif will throw error for missing required flag
        expect(error).to.exist
      }
    })

    it('should handle service start errors gracefully', async () => {
      fileWatcherService.start.rejects(new Error('Failed to start watcher'))
      fileWatcherService.stop.resolves()

      const command = new TestableWatch(fileWatcherService, projectConfigStore, ['--paths', './test'], config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.equal('Failed to start watcher')
      }
    })
  })
})
