import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {ITerminal} from '../../src/core/interfaces/i-terminal.js'
import type {ITrackingService} from '../../src/core/interfaces/i-tracking-service.js'
import type {TransportClientFactory} from '../../src/infra/transport/transport-client-factory.js'

import {
  ConnectionError,
  ConnectionFailedError,
  InstanceCrashedError,
  NoInstanceRunningError,
} from '../../src/core/domain/errors/connection-error.js'
import {CurateUseCase, type CurateUseCaseOptions} from '../../src/infra/usecase/curate-use-case.js'
import {
  createMockTerminal,
  createMockTransportClient,
  createMockTransportFactory,
  type MockTransportClient,
  type MockTransportFactory,
} from '../helpers/mock-factories.js'

/**
 * Testable subclass that allows injecting mock transport factory.
 * Uses type assertion to bypass strict type checking for test mocks.
 */
class TestableCurateUseCase extends CurateUseCase {
  constructor(options: CurateUseCaseOptions, private mockFactory: MockTransportFactory) {
    super(options)
  }

  protected createTransportFactory(): TransportClientFactory {
    // Cast mock factory to TransportClientFactory for testing
    return this.mockFactory as unknown as TransportClientFactory
  }
}

describe('Curate Command', () => {
  let sandbox: sinon.SinonSandbox
  let loggedMessages: string[]
  let terminal: ITerminal
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>
  let mockClient: MockTransportClient
  let mockFactory: MockTransportFactory

  beforeEach(() => {
    sandbox = sinon.createSandbox()
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

    mockClient = createMockTransportClient(sandbox)
    mockFactory = createMockTransportFactory(sandbox, mockClient)
  })

  afterEach(() => {
    sandbox.restore()
    restore()
  })

  function createUseCaseOptions(): CurateUseCaseOptions {
    return {
      terminal,
      trackingService,
    }
  }

  function createTestableUseCase(): TestableCurateUseCase {
    return new TestableCurateUseCase(createUseCaseOptions(), mockFactory)
  }

  describe('run - validation', () => {
    it('should require context argument', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({})

      expect(loggedMessages.some((m) => m.includes('Context argument is required'))).to.be.true
    })

    it('should show usage message when context is missing', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({})

      expect(loggedMessages.some((m) => m.includes('brv curate "your context here"'))).to.be.true
    })

    it('should track curate started event', async () => {
      const useCase = new CurateUseCase(createUseCaseOptions())

      await useCase.run({})

      expect(trackingService.track.calledWith('mem:curate', {status: 'started'})).to.be.true
    })
  })

  describe('run - connection errors', () => {
    it('should handle NoInstanceRunningError with appropriate message', async () => {
      mockFactory.connect.rejects(new NoInstanceRunningError())
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context'})

      // Either sandbox or non-sandbox message should be shown (depends on environment)
      const hasNoInstanceMessage = loggedMessages.some(
        (m) => m.includes('No ByteRover instance is running') || m.includes("run 'brv' command"),
      )
      expect(hasNoInstanceMessage).to.be.true
    })

    it('should handle InstanceCrashedError', async () => {
      mockFactory.connect.rejects(new InstanceCrashedError())
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context'})

      expect(loggedMessages.some((m) => m.includes('ByteRover instance has crashed'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Please restart with: brv'))).to.be.true
    })

    it('should handle ConnectionFailedError', async () => {
      mockFactory.connect.rejects(new ConnectionFailedError(9847, new Error('Connection refused')))
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context'})

      // Either sandbox network restriction or generic connection failed message
      const hasConnectionFailedMessage = loggedMessages.some(
        (m) => m.includes('Failed to connect') || m.includes('Sandbox network restriction'),
      )
      expect(hasConnectionFailedMessage).to.be.true
    })

    it('should handle generic ConnectionError', async () => {
      mockFactory.connect.rejects(new ConnectionError('Generic connection error'))
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context'})

      expect(loggedMessages.some((m) => m.includes('Connection error'))).to.be.true
    })

    it('should handle unexpected errors', async () => {
      mockFactory.connect.rejects(new Error('Something went wrong'))
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context'})

      expect(loggedMessages.some((m) => m.includes('Unexpected error'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('Something went wrong'))).to.be.true
    })

    it('should track error event on connection failure', async () => {
      mockFactory.connect.rejects(new NoInstanceRunningError())
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context'})

      expect(trackingService.track.calledWith('mem:curate', sinon.match({status: 'error'}))).to.be.true
    })
  })

  describe('run - success path', () => {
    it('should queue context for processing', async () => {
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context'})

      expect(loggedMessages.some((m) => m.includes('Context queued for processing'))).to.be.true
    })

    it('should send task:create request with correct payload', async () => {
      const useCase = createTestableUseCase()

      await useCase.run({context: 'my knowledge context'})

      const requestStub = mockClient.request as sinon.SinonStub
      expect(requestStub.calledOnce).to.be.true
      const [event, payload] = requestStub.firstCall.args
      expect(event).to.equal('task:create')
      expect(payload).to.have.property('content', 'my knowledge context')
      expect(payload).to.have.property('type', 'curate')
      expect(payload).to.have.property('taskId')
    })

    it('should pass files to task:create when provided', async () => {
      const useCase = createTestableUseCase()
      const files = ['src/auth.ts', 'src/middleware.ts']

      await useCase.run({context: 'test context', files})

      const requestStub = mockClient.request as sinon.SinonStub
      const [, payload] = requestStub.firstCall.args
      expect(payload).to.have.property('files').that.deep.equals(files)
    })

    it('should not include files in request when empty', async () => {
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context', files: []})

      const requestStub = mockClient.request as sinon.SinonStub
      const [, payload] = requestStub.firstCall.args
      expect(payload).to.not.have.property('files')
    })

    it('should track finished event on success', async () => {
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context'})

      expect(trackingService.track.calledWith('mem:curate', {status: 'finished'})).to.be.true
    })

    it('should disconnect client after completion', async () => {
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context'})

      const disconnectStub = mockClient.disconnect as sinon.SinonStub
      expect(disconnectStub.calledOnce).to.be.true
    })
  })

  describe('run - verbose mode', () => {
    it('should log discovery message when verbose', async () => {
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context', verbose: true})

      expect(loggedMessages.some((m) => m.includes('Discovering running instance'))).to.be.true
    })

    it('should log connection info when verbose', async () => {
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context', verbose: true})

      expect(loggedMessages.some((m) => m.includes('Connected to instance'))).to.be.true
      expect(loggedMessages.some((m) => m.includes('clientId'))).to.be.true
    })

    it('should not log verbose messages when verbose is false', async () => {
      const useCase = createTestableUseCase()

      await useCase.run({context: 'test context', verbose: false})

      expect(loggedMessages.some((m) => m.includes('Discovering running instance'))).to.be.false
    })
  })
})
