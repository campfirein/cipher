import type {Config} from '@oclif/core'

import {Config as OclifConfig, ux} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {IPlaybookService} from '../../src/core/interfaces/i-playbook-service.js'
import type {IPlaybookStore} from '../../src/core/interfaces/i-playbook-store.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'

import Add from '../../src/commands/add.js'
import {Bullet} from '../../src/core/domain/entities/bullet.js'
import {Playbook} from '../../src/core/domain/entities/playbook.js'

// Type definitions from add.ts
type UserAction = 'add' | 'update'

interface SectionPromptOptions {
  readonly existingSections: readonly string[]
  readonly suggestedSections: readonly string[]
}

interface ContentPromptContext {
  readonly action: UserAction
  readonly existingContent?: string
  readonly section: string
}

/**
 * Testable Add command that accepts mocked services and prompt responses
 */
class TestableAdd extends Add {
  // eslint-disable-next-line max-params
  public constructor(
    private readonly mockAction: UserAction,
    private readonly mockBulletId: string | undefined,
    private readonly mockContent: string,
    private readonly mockPlaybookService: IPlaybookService,
    private readonly mockPlaybookStore: IPlaybookStore,
    private readonly mockSection: string,
    private readonly mockTrackingService: ITrackingService,
    config: Config,
  ) {
    super(['--interactive'], config)
  }

  protected createServices() {
    return {
      playbookService: this.mockPlaybookService,
      playbookStore: this.mockPlaybookStore,
      trackingService: this.mockTrackingService,
    }
  }

  // Suppress all output to prevent noisy test runs
  public error(input: Error | string): never {
    // Throw error to maintain behavior but suppress output
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(): void {
    // Do nothing - suppress output
  }

  // Override prompts
  protected async promptForAction(): Promise<UserAction> {
    return this.mockAction
  }

  protected async promptForBullet(_bullets: Bullet[]): Promise<string> {
    if (!this.mockBulletId) throw new Error('No bullet ID provided')
    return this.mockBulletId
  }

  protected async promptForContent(_context: ContentPromptContext): Promise<string> {
    return this.mockContent
  }

  protected async promptForSection(_options: SectionPromptOptions): Promise<string> {
    return this.mockSection
  }

  public warn(input: Error | string): Error | string {
    // Do nothing - suppress output, but return input to match base signature
    return input
  }
}

/**
 * Helper to create a mock Bullet instance
 */
function createMockBullet(overrides?: {
  content?: string
  id?: string
  memoryId?: string
  metadata?: {relatedFiles?: string[]; tags?: string[]; timestamp?: string}
  section?: string
}): Bullet {
  return new Bullet(
    overrides?.id ?? 'test-00001',
    overrides?.section ?? 'Testing',
    overrides?.content ?? 'Test content',
    {
      relatedFiles: overrides?.metadata?.relatedFiles ?? [],
      tags: overrides?.metadata?.tags ?? ['manual'],
      timestamp: overrides?.metadata?.timestamp ?? new Date().toISOString(),
    },
    overrides?.memoryId,
  )
}

describe('Add Command', () => {
  let config: Config
  let mockPlaybook: {
    addBullet: sinon.SinonStub
    getBullet: sinon.SinonStub
    getBullets: sinon.SinonStub
    getSections: sinon.SinonStub
    updateBullet: sinon.SinonStub
  }
  let playbookService: sinon.SinonStubbedInstance<IPlaybookService>
  let playbookStore: sinon.SinonStubbedInstance<IPlaybookStore>
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let uxActionStartStub: sinon.SinonStub
  let uxActionStopStub: sinon.SinonStub

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    uxActionStartStub = stub(ux.action, 'start')
    uxActionStopStub = stub(ux.action, 'stop')

    mockPlaybook = {
      addBullet: stub(),
      getBullet: stub(),
      getBullets: stub(),
      getSections: stub().returns(['Existing Section']),
      updateBullet: stub(),
    }

    playbookStore = {
      clear: stub(),
      delete: stub(),
      exists: stub().resolves(true),
      load: stub().resolves(mockPlaybook as unknown as Playbook),
      save: stub().resolves(),
    } as unknown as sinon.SinonStubbedInstance<IPlaybookStore>

    playbookService = {
      addOrUpdateBullet: stub(),
      applyDelta: stub(),
      applyReflectionTags: stub(),
      initialize: stub(),
    } as unknown as sinon.SinonStubbedInstance<IPlaybookService>

    trackingService = {
      track: stub().resolves(),
    } as unknown as sinon.SinonStubbedInstance<ITrackingService>
  })

  afterEach(() => {
    uxActionStartStub.restore()
    uxActionStopStub.restore()
    restore()
  })

  describe('Interactive Mode', () => {
    describe('Add New Bullet', () => {
      it('should add new bullet in interactive mode', async () => {
        const mockBullet = createMockBullet({
          content: 'Always validate input',
          id: 'best-00001',
          section: 'Best Practices',
        })

        playbookService.addOrUpdateBullet.resolves(mockBullet)

        const cmd = new TestableAdd(
          'add', // action
          undefined, // no bulletId
          'Always validate input', // content
          playbookService,
          playbookStore,
          'Best Practices', // section
          trackingService,
          config,
        )

        await cmd.run()

        expect(playbookService.addOrUpdateBullet.calledOnce).to.be.true
        expect(
          playbookService.addOrUpdateBullet.calledWith({
            bulletId: undefined,
            content: 'Always validate input',
            section: 'Best Practices',
          }),
        ).to.be.true

        expect(trackingService.track.calledOnce).to.be.true
        expect(
          trackingService.track.calledWith('ace:add_bullet', {
            interactive: true,
            section: 'Best Practices',
            update: false,
          }),
        ).to.be.true
      })

      it('should load existing playbook sections for section selection', async () => {
        const mockBullet = createMockBullet({
          content: 'Test content',
          section: 'Existing Section',
        })

        playbookService.addOrUpdateBullet.resolves(mockBullet)

        const cmd = new TestableAdd(
          'add',
          undefined,
          'Test content',
          playbookService,
          playbookStore,
          'Existing Section',
          trackingService,
          config,
        )

        await cmd.run()

        expect(playbookStore.load.calledOnce).to.be.true
        expect(mockPlaybook.getSections.calledOnce).to.be.true
      })
    })

    describe('Update Existing Bullet', () => {
      it('should update existing bullet in interactive mode', async () => {
        const existingBullet = createMockBullet({
          content: 'Old content',
          id: 'test-00001',
          metadata: {
            relatedFiles: [],
            tags: ['manual'],
            timestamp: new Date('2024-01-01').toISOString(),
          },
          section: 'Best Practices',
        })

        const updatedBullet = createMockBullet({
          content: 'New content',
          id: 'test-00001',
          section: 'Best Practices',
        })

        mockPlaybook.getBullets.returns([existingBullet])
        mockPlaybook.getBullet.withArgs('test-00001').returns(existingBullet)
        playbookService.addOrUpdateBullet.resolves(updatedBullet)

        const cmd = new TestableAdd(
          'update', // action
          'test-00001', // bulletId
          'New content', // content
          playbookService,
          playbookStore,
          'Best Practices', // section
          trackingService,
          config,
        )

        await cmd.run()

        expect(playbookService.addOrUpdateBullet.calledOnce).to.be.true
        expect(
          playbookService.addOrUpdateBullet.calledWith({
            bulletId: 'test-00001',
            content: 'New content',
            section: 'Best Practices',
          }),
        ).to.be.true

        expect(trackingService.track.calledOnce).to.be.true
        expect(
          trackingService.track.calledWith('ace:add_bullet', {
            interactive: true,
            section: 'Best Practices',
            update: true,
          }),
        ).to.be.true
      })

      it('should fall back to add when update selected but no bullets exist', async () => {
        const mockBullet = createMockBullet({
          content: 'New error content',
          id: 'common-00001',
          section: 'Common Errors',
        })

        mockPlaybook.getBullets.returns([])
        playbookService.addOrUpdateBullet.resolves(mockBullet)

        const cmd = new TestableAdd(
          'update', // user wants to update
          undefined, // but no bullets available
          'New error content',
          playbookService,
          playbookStore,
          'Common Errors',
          trackingService,
          config,
        )

        await cmd.run()

        // Should add instead of update
        expect(playbookService.addOrUpdateBullet.calledOnce).to.be.true
        expect(
          playbookService.addOrUpdateBullet.calledWith({
            bulletId: undefined,
            content: 'New error content',
            section: 'Common Errors',
          }),
        ).to.be.true
      })
    })

    describe('Playbook Initialization', () => {
      it('should create new playbook when none exists', async () => {
        const mockBullet = createMockBullet({
          content: 'First bullet',
          section: 'Testing',
        })

        playbookStore.load.resolves() // No existing playbook
        playbookService.addOrUpdateBullet.resolves(mockBullet)

        const cmd = new TestableAdd(
          'add',
          undefined,
          'First bullet',
          playbookService,
          playbookStore,
          'Testing',
          trackingService,
          config,
        )

        await cmd.run()

        expect(playbookStore.load.calledOnce).to.be.true
        expect(playbookService.addOrUpdateBullet.calledOnce).to.be.true
      })
    })
  })

  describe('Flag-Based Mode', () => {
    /**
     * Testable Add command for flag-based tests
     */
    class TestableFlagBasedAdd extends Add {
      constructor(
        private readonly mockServices: {
          playbookService: IPlaybookService
          playbookStore: IPlaybookStore
          trackingService: ITrackingService
        },
        args: string[],
        config: Config,
      ) {
        super(args, config)
      }

      protected createServices() {
        return this.mockServices
      }

      public error(input: Error | string): never {
        throw new Error(typeof input === 'string' ? input : input.message)
      }

      public log(): void {
        // Suppress output
      }

      public warn(input: Error | string): Error | string {
        return input
      }
    }

    it('should work in flag-based mode without interactive flag', async () => {
      const mockBullet = createMockBullet({
        content: 'Auth token expired',
        id: 'common-00001',
        section: 'Common Errors',
      })

      playbookService.addOrUpdateBullet.resolves(mockBullet)

      const cmd = new TestableFlagBasedAdd(
        {playbookService, playbookStore, trackingService},
        ['--section', 'Common Errors', '--content', 'Auth token expired'],
        config,
      )

      await cmd.run()

      expect(playbookService.addOrUpdateBullet.calledOnce).to.be.true
      expect(
        playbookService.addOrUpdateBullet.calledWith({
          bulletId: undefined,
          content: 'Auth token expired',
          section: 'Common Errors',
        }),
      ).to.be.true

      expect(trackingService.track.calledOnce).to.be.true
      expect(
        trackingService.track.calledWith('ace:add_bullet', {
          interactive: false,
          section: 'Common Errors',
          update: false,
        }),
      ).to.be.true
    })

    it('should update bullet with bullet-id flag', async () => {
      const mockBullet = createMockBullet({
        content: 'Updated: Auth fails',
        id: 'common-00001',
        section: 'Common Errors',
      })

      playbookService.addOrUpdateBullet.resolves(mockBullet)

      const cmd = new TestableFlagBasedAdd(
        {playbookService, playbookStore, trackingService},
        ['--section', 'Common Errors', '--content', 'Updated: Auth fails', '--bullet-id', 'common-00001'],
        config,
      )

      await cmd.run()

      expect(playbookService.addOrUpdateBullet.calledOnce).to.be.true
      expect(
        playbookService.addOrUpdateBullet.calledWith({
          bulletId: 'common-00001',
          content: 'Updated: Auth fails',
          section: 'Common Errors',
        }),
      ).to.be.true

      expect(trackingService.track.calledOnce).to.be.true
      expect(
        trackingService.track.calledWith('ace:add_bullet', {
          interactive: false,
          section: 'Common Errors',
          update: true,
        }),
      ).to.be.true
    })

    it('should throw error when section is missing in non-interactive mode', async () => {
      const cmd = new TestableFlagBasedAdd(
        {playbookService, playbookStore, trackingService},
        ['--content', 'Some content'],
        config,
      )

      try {
        await cmd.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.equal('--section and --content are required in non-interactive mode')
      }
    })

    it('should throw error when content is missing in non-interactive mode', async () => {
      const cmd = new TestableFlagBasedAdd(
        {playbookService, playbookStore, trackingService},
        ['--section', 'Common Errors'],
        config,
      )

      try {
        await cmd.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.equal('--section and --content are required in non-interactive mode')
      }
    })
  })

  describe('Validation', () => {
    it('should handle service errors gracefully', async () => {
      playbookService.addOrUpdateBullet.rejects(new Error('Service error'))

      const cmd = new TestableAdd(
        'add',
        undefined,
        'Test content',
        playbookService,
        playbookStore,
        'Testing',
        trackingService,
        config,
      )

      try {
        await cmd.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.equal('Service error')
      }
    })
  })
})
