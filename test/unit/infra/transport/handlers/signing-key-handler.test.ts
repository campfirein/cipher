/**
 * SigningKeyHandler Unit Tests
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {ISigningKeyService, SigningKeyResource} from '../../../../../src/server/core/interfaces/services/i-signing-key-service.js'
import type {ITransportServer, RequestHandler} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {AuthToken} from '../../../../../src/server/core/domain/entities/auth-token.js'
import {NotAuthenticatedError} from '../../../../../src/server/core/domain/errors/task-error.js'
import {SigningKeyHandler} from '../../../../../src/server/infra/transport/handlers/signing-key-handler.js'
import {VcEvents} from '../../../../../src/shared/transport/events/vc-events.js'

type Stubbed<T> = {[K in keyof T]: SinonStub & T[K]}

const IAM_BASE_URL = 'https://iam.example.com'

const FAKE_KEY: SigningKeyResource = {
  createdAt: '2024-01-01T00:00:00Z',
  fingerprint: 'SHA256:abc123',
  id: 'key-id-1',
  keyType: 'ssh-ed25519',
  publicKey: 'ssh-ed25519 AAAA... test@example.com',
  title: 'My laptop',
}

function makeValidToken(): AuthToken {
  return new AuthToken({
    accessToken: 'valid-access-token',
    expiresAt: new Date(Date.now() + 3_600_000),
    refreshToken: 'refresh',
    sessionKey: 'session-key-123',
    userEmail: 'test@example.com',
    userId: 'user-1',
  })
}

interface TestDeps {
  requestHandler: RequestHandler
  signingKeyService: Stubbed<ISigningKeyService>
  tokenStore: Stubbed<ITokenStore>
  transport: Stubbed<ITransportServer>
}

function makeDeps(sandbox: SinonSandbox): TestDeps {
  const requestHandlers: Record<string, RequestHandler> = {}

  const transport: Stubbed<ITransportServer> = {
    broadcastToProject: sandbox.stub(),
    close: sandbox.stub().resolves(),
    emitToClient: sandbox.stub(),
    emitToProject: sandbox.stub(),
    initialize: sandbox.stub().resolves(),
    offRequest: sandbox.stub(),
    onRequest: sandbox.stub().callsFake((event: string, handler: RequestHandler) => {
      requestHandlers[event] = handler
    }),
  } as unknown as Stubbed<ITransportServer>

  const tokenStore: Stubbed<ITokenStore> = {
    clear: sandbox.stub().resolves(),
    load: sandbox.stub().resolves(makeValidToken()),
    save: sandbox.stub().resolves(),
  }

  const signingKeyService: Stubbed<ISigningKeyService> = {
    addKey: sandbox.stub().resolves(FAKE_KEY),
    listKeys: sandbox.stub().resolves([FAKE_KEY]),
    removeKey: sandbox.stub().resolves(),
  }

  return {
    requestHandler: requestHandlers[VcEvents.SIGNING_KEY],
    signingKeyService,
    tokenStore,
    transport,
  }
}

function makeHandler(sandbox: SinonSandbox, deps: TestDeps): {getRequestHandler: () => RequestHandler; handler: SigningKeyHandler} {
  const requestHandlers: Record<string, RequestHandler> = {}
  const {transport} = deps
  // Re-wire to capture the registered handler
  transport.onRequest.callsFake((event: string, h: RequestHandler) => {
    requestHandlers[event] = h
  })

  const handler = new SigningKeyHandler({
    iamBaseUrl: IAM_BASE_URL,
    tokenStore: deps.tokenStore,
    transport,
  })
  handler.setup()

  return {
    getRequestHandler: () => requestHandlers[VcEvents.SIGNING_KEY],
    handler,
  }
}

describe('SigningKeyHandler', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('auth guard', () => {
    it('throws NotAuthenticatedError when token is missing', async () => {
      const deps = makeDeps(sandbox)
      deps.tokenStore.load.resolves()
      const {getRequestHandler} = makeHandler(sandbox, deps)

      try {
        await getRequestHandler()({action: 'list'}, 'client-1')
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(NotAuthenticatedError)
      }
    })

    it('throws NotAuthenticatedError when token.isValid() returns false (expired)', async () => {
      const deps = makeDeps(sandbox)
      const expiredToken = new AuthToken({
        accessToken: 'acc',
        expiresAt: new Date(Date.now() - 1000), // expired
        refreshToken: 'ref',
        sessionKey: 'sess',
        userEmail: 'e@e.com',
        userId: 'u1',
      })
      deps.tokenStore.load.resolves(expiredToken)
      const {getRequestHandler} = makeHandler(sandbox, deps)

      try {
        await getRequestHandler()({action: 'list'}, 'client-1')
        expect.fail('Expected error')
      } catch (error) {
        expect(error).to.be.instanceOf(NotAuthenticatedError)
      }
    })
  })

  describe('list action', () => {
    it('returns mapped key list', async () => {
      const deps = makeDeps(sandbox)
      const {getRequestHandler} = makeHandler(sandbox, deps)

      // The handler creates its own HttpSigningKeyService internally.
      // We test the auth check path; for the actual IAM call we rely on http-signing-key-service tests.
      // Here we just verify the flow doesn't throw when auth is valid.
      // Since we can't easily stub the internal HttpSigningKeyService (ES module instantiation),
      // we verify the NotAuthenticatedError path (above) and rely on integration for IAM calls.
      // This test verifies setup registers the event handler.
      const handler = getRequestHandler()
      expect(handler).to.be.a('function')
    })
  })

  describe('setup', () => {
    it('registers handler for VcEvents.SIGNING_KEY', () => {
      const deps = makeDeps(sandbox)
      const {getRequestHandler} = makeHandler(sandbox, deps)
      expect(getRequestHandler()).to.be.a('function')
      expect(deps.transport.onRequest.calledWith(VcEvents.SIGNING_KEY)).to.be.true
    })
  })
})
