import {
  ConnectionFailedError,
  type ConnectionResult,
  InstanceCrashedError,
  type ITransportClient,
  NoInstanceRunningError,
} from '@campfirein/brv-transport-client'
import {expect} from 'chai'
import sinon, {match, restore, stub} from 'sinon'

import type {ITerminal} from '../../src/server/core/interfaces/services/i-terminal.js'
import type {ITrackingService} from '../../src/server/core/interfaces/services/i-tracking-service.js'

import {
  CurateUseCase,
  type CurateUseCaseOptions,
  type TransportConnector,
} from '../../src/server/infra/usecase/curate-use-case.js'
import {createMockTerminal} from '../helpers/mock-factories.js'

describe('Curate Command', () => {
  let loggedMessages: string[]
  let terminal: ITerminal
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let mockClient: sinon.SinonStubbedInstance<ITransportClient>
  let mockConnector: TransportConnector

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
      on: stub().returns(() => {}),
      once: stub(),
      onStateChange: stub().returns(() => {}),
      request: stub() as unknown as ITransportClient['request'],
      requestWithAck: stub().resolves({}),
    } as unknown as sinon.SinonStubbedInstance<ITransportClient>

    // Create mock connector (replaces factory pattern)
    mockConnector = stub().resolves({
      client: mockClient,
      projectRoot: '/test/project',
    } as ConnectionResult)
  })

  afterEach(() => {
    restore()
  })

  function createUseCaseOptions(overrides?: Partial<CurateUseCaseOptions>): CurateUseCaseOptions {
    return {
      terminal,
      trackingService,
      transportConnector: mockConnector,
      ...overrides,
    }
  }

  describe('run', () => {
    it('should show usage message when context is not provided', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({})

      expect(loggedMessages).to.include('Context argument is required.')
      expect(loggedMessages).to.include('Usage: brv curate "your context here"')
      expect(trackingService.track.calledWith('mem:curate', {status: 'started'})).to.be.true
    })

    it('should send task:create request with context and taskId', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({context: 'test context'})

      expect(mockClient.requestWithAck.calledOnce).to.be.true
      const [event, payload] = (mockClient.requestWithAck as sinon.SinonStub).firstCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', 'test context')
      expect(payload).to.have.property('type', 'curate')
      expect(payload).to.have.property('taskId').that.is.a('string')
      expect(loggedMessages).to.include('✓ Context queued for processing.')
      expect(trackingService.track.calledWith('mem:curate', {status: 'finished'})).to.be.true
    })

    it('should send task:create request with context, files, and taskId', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({context: 'test context', files: ['file1.ts', 'file2.ts']})

      expect(mockClient.requestWithAck.calledOnce).to.be.true
      const [event, payload] = (mockClient.requestWithAck as sinon.SinonStub).firstCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', 'test context')
      expect(payload).to.have.property('files').that.deep.equals(['file1.ts', 'file2.ts'])
      expect(payload).to.have.property('type', 'curate')
      expect(payload).to.have.property('taskId').that.is.a('string')
    })

    it('should log verbose messages when verbose is true', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({context: 'test context', verbose: true})

      expect(loggedMessages.some((m) => m.includes('Discovering running instance'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Connected to instance'))).to.be.true
    })

    it('should disconnect client after successful request', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({context: 'test context'})

      expect(mockClient.disconnect.calledOnce).to.be.true
    })

    it('should handle NoInstanceRunningError', async () => {
      const errorConnector = stub().rejects(new NoInstanceRunningError())
      const useCase = new CurateUseCase(
        createUseCaseOptions({
          transportConnector: errorConnector,
        }),
      )

      await useCase.run({context: 'test context'})

      expect(loggedMessages.some((m) => m.includes('No ByteRover instance is running'))).to.be.true
      expect(trackingService.track.calledWith('mem:curate', match({status: 'error'}))).to.be.true
    })

    it('should handle InstanceCrashedError', async () => {
      const errorConnector = stub().rejects(new InstanceCrashedError())
      const useCase = new CurateUseCase(
        createUseCaseOptions({
          transportConnector: errorConnector,
        }),
      )

      await useCase.run({context: 'test context'})

      expect(loggedMessages.some((m) => m.includes('ByteRover instance has crashed'))).to.be.true
      expect(trackingService.track.calledWith('mem:curate', match({status: 'error'}))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      const errorConnector = stub().rejects(new ConnectionFailedError(9847, new Error('Connection refused')))
      const useCase = new CurateUseCase(
        createUseCaseOptions({
          transportConnector: errorConnector,
        }),
      )

      await useCase.run({context: 'test context'})

      expect(loggedMessages.some((m) => m.includes('Failed to connect'))).to.be.true
      expect(trackingService.track.calledWith('mem:curate', match({status: 'error'}))).to.be.true
    })

    it('should handle unexpected errors', async () => {
      const errorConnector = stub().rejects(new Error('Unexpected error'))
      const useCase = new CurateUseCase(
        createUseCaseOptions({
          transportConnector: errorConnector,
        }),
      )

      await useCase.run({context: 'test context'})

      expect(loggedMessages.some((m) => m.includes('Unexpected error'))).to.be.true
      expect(trackingService.track.calledWith('mem:curate', match({status: 'error'}))).to.be.true
    })

    it('should disconnect client even when request fails', async () => {
      mockClient.requestWithAck.rejects(new Error('Request failed'))

      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({context: 'test context'})

      expect(mockClient.disconnect.calledOnce).to.be.true
    })
  })
})
