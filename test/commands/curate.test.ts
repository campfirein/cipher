import { expect } from 'chai'
import sinon, { match, restore, stub } from 'sinon'

import type { ITerminal } from '../../src/core/interfaces/i-terminal.js'
import type { ITrackingService } from '../../src/core/interfaces/i-tracking-service.js'
import type { ITransportClient } from '../../src/core/interfaces/transport/i-transport-client.js'
import type { TransportClientFactory } from '../../src/infra/transport/transport-client-factory.js'

import {
  ConnectionFailedError,
  InstanceCrashedError,
  NoInstanceRunningError,
} from '../../src/core/domain/errors/connection-error.js'
import { CurateUseCase, type CurateUseCaseOptions } from '../../src/infra/usecase/curate-use-case.js'
import { createMockTerminal } from '../helpers/mock-factories.js'

describe('Curate Command', () => {
  let loggedMessages: string[]
  let terminal: ITerminal
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockFactory: Partial<TransportClientFactory>

  beforeEach(() => {
    loggedMessages = []

    terminal = createMockTerminal({
      log(message?: string) {
        if (message) {
          loggedMessages.push(message)
        }
      },
    })

    trackingService = {
      track: stub().resolves(),
    } as unknown as sinon.SinonStubbedInstance<ITrackingService>

    // Create mock transport client
    mockClient = {
      connect: stub().resolves(),
      disconnect: stub().resolves(),
      getClientId: stub().returns('test-client-id'),
      getState: stub().returns('connected'),
      joinRoom: stub().resolves(),
      leaveRoom: stub().resolves(),
      on: stub().returns(() => { }),
      once: stub(),
      onStateChange: stub().returns(() => { }),
      request: stub().resolves({}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    // Create mock factory
    mockFactory = {
      connect: stub().resolves({
        client: mockClient,
        projectRoot: '/test/project',
      }),
    }
  })

  afterEach(() => {
    restore()
  })

  function createUseCaseOptions(overrides?: Partial<CurateUseCaseOptions>): CurateUseCaseOptions {
    return {
      terminal,
      trackingService,
      transportClientFactoryCreator: () => mockFactory as TransportClientFactory,
      ...overrides,
    }
  }

  describe('run', () => {
    it('should show usage message when neither context nor files are provided', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({})

      expect(loggedMessages).to.include('Either a context argument or file reference is required.')
      expect(trackingService.track.calledWith('mem:curate', { status: 'started' })).to.be.true
    })

    it('should send task:create with empty content when only files provided', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({ files: ['src/auth.ts', 'src/utils.ts'] })
      expect(mockClient.request.calledOnce).to.be.true
      const [event, payload] = mockClient.request.firstCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', '')
      expect(payload).to.have.property('files').that.deep.equals(['src/auth.ts', 'src/utils.ts'])
      expect(payload).to.have.property('type', 'curate')
      expect(loggedMessages).to.include('✓ Context queued for processing.')
    })

    it('should treat whitespace-only context as no context', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({ context: '   ' })

      expect(loggedMessages).to.include('Either a context argument or file reference is required.')
    })

    it('should send task:create request with context and taskId', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({ context: 'test context' })

      expect(mockClient.request.calledOnce).to.be.true
      const [event, payload] = (mockClient.request as sinon.SinonStub).firstCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', 'test context')
      expect(payload).to.have.property('type', 'curate')
      expect(payload).to.have.property('taskId').that.is.a('string')
      expect(loggedMessages).to.include('✓ Context queued for processing.')
      expect(trackingService.track.calledWith('mem:curate', { status: 'finished' })).to.be.true
    })

    it('should send task:create request with context, files, and taskId', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({ context: 'test context', files: ['file1.ts', 'file2.ts'] })

      expect(mockClient.request.calledOnce).to.be.true
      const [event, payload] = (mockClient.request as sinon.SinonStub).firstCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', 'test context')
      expect(payload).to.have.property('files').that.deep.equals(['file1.ts', 'file2.ts'])
      expect(payload).to.have.property('type', 'curate')
      expect(payload).to.have.property('taskId').that.is.a('string')
    })

    it('should log verbose messages when verbose is true', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({ context: 'test context', verbose: true })

      expect(loggedMessages.some((m) => m.includes('Discovering running instance'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Connected to instance'))).to.be.true
    })

    it('should disconnect client after successful request', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({ context: 'test context' })

      expect(mockClient.disconnect.calledOnce).to.be.true
    })

    it('should handle NoInstanceRunningError', async () => {
      const errorFactory = {
        connect: stub().rejects(new NoInstanceRunningError()),
      }
      const useCase = new CurateUseCase(
        createUseCaseOptions({
          transportClientFactoryCreator: () => errorFactory as unknown as TransportClientFactory,
        }),
      )

      await useCase.run({ context: 'test context' })

      expect(loggedMessages.some((m) => m.includes('No ByteRover instance is running'))).to.be.true
      expect(trackingService.track.calledWith('mem:curate', match({ status: 'error' }))).to.be.true
    })

    it('should handle InstanceCrashedError', async () => {
      const errorFactory = {
        connect: stub().rejects(new InstanceCrashedError()),
      }
      const useCase = new CurateUseCase(
        createUseCaseOptions({
          transportClientFactoryCreator: () => errorFactory as unknown as TransportClientFactory,
        }),
      )

      await useCase.run({ context: 'test context' })

      expect(loggedMessages.some((m) => m.includes('ByteRover instance has crashed'))).to.be.true
      expect(trackingService.track.calledWith('mem:curate', match({ status: 'error' }))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      const errorFactory = {
        connect: stub().rejects(new ConnectionFailedError(9847, new Error('Connection refused'))),
      }
      const useCase = new CurateUseCase(
        createUseCaseOptions({
          transportClientFactoryCreator: () => errorFactory as unknown as TransportClientFactory,
        }),
      )

      await useCase.run({ context: 'test context' })

      expect(loggedMessages.some((m) => m.includes('Failed to connect'))).to.be.true
      expect(trackingService.track.calledWith('mem:curate', match({ status: 'error' }))).to.be.true
    })

    it('should handle unexpected errors', async () => {
      const errorFactory = {
        connect: stub().rejects(new Error('Unexpected error')),
      }
      const useCase = new CurateUseCase(
        createUseCaseOptions({
          transportClientFactoryCreator: () => errorFactory as unknown as TransportClientFactory,
        }),
      )

      await useCase.run({ context: 'test context' })

      expect(loggedMessages.some((m) => m.includes('Unexpected error'))).to.be.true
      expect(trackingService.track.calledWith('mem:curate', match({ status: 'error' }))).to.be.true
    })

    it('should disconnect client even when request fails', async () => {
      mockClient.request.rejects(new Error('Request failed'))

      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({ context: 'test context' })

      expect(mockClient.disconnect.calledOnce).to.be.true
    })
  })
})
