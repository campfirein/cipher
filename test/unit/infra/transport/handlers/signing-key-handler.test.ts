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
import {type SigningKeyItem, VcEvents} from '../../../../../src/shared/transport/events/vc-events.js'

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

function makeHandlerWithInjectedService(sb: SinonSandbox): {
  getRequestHandler: () => RequestHandler
  signingKeyService: Stubbed<ISigningKeyService>
} {
  const requestHandlers: Record<string, RequestHandler> = {}

  const signingKeyService: Stubbed<ISigningKeyService> = {
    addKey: sb.stub().resolves(FAKE_KEY),
    listKeys: sb.stub().resolves([FAKE_KEY]),
    removeKey: sb.stub().resolves(),
  }

  const tokenStore: Stubbed<ITokenStore> = {
    clear: sb.stub().resolves(),
    load: sb.stub().resolves(makeValidToken()),
    save: sb.stub().resolves(),
  }

  const transport: Stubbed<ITransportServer> = {
    broadcastToProject: sb.stub(),
    close: sb.stub().resolves(),
    emitToClient: sb.stub(),
    emitToProject: sb.stub(),
    initialize: sb.stub().resolves(),
    offRequest: sb.stub(),
    onRequest: sb.stub().callsFake((event: string, h: RequestHandler) => {
      requestHandlers[event] = h
    }),
  } as unknown as Stubbed<ITransportServer>

  const handler = new SigningKeyHandler({
    iamBaseUrl: IAM_BASE_URL,
    signingKeyService,
    tokenStore,
    transport,
  })
  handler.setup()

  return {
    getRequestHandler: () => requestHandlers[VcEvents.SIGNING_KEY],
    signingKeyService,
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

  describe('setup', () => {
    it('registers handler for VcEvents.SIGNING_KEY', () => {
      const deps = makeDeps(sandbox)
      const {getRequestHandler} = makeHandler(sandbox, deps)
      expect(getRequestHandler()).to.be.a('function')
      expect(deps.transport.onRequest.calledWith(VcEvents.SIGNING_KEY)).to.be.true
    })
  })

  describe('action routing (via injectable service seam)', () => {
    it('add action calls service.addKey and returns mapped key', async () => {
      const {getRequestHandler, signingKeyService} = makeHandlerWithInjectedService(sandbox)

      const result = await getRequestHandler()(
        {action: 'add', publicKey: 'ssh-ed25519 AAAA... test@example.com', title: 'My laptop'},
        'client-1',
      ) as {action: string; key: SigningKeyItem}

      expect(signingKeyService.addKey.calledOnce).to.be.true
      expect(signingKeyService.addKey.calledWith('My laptop', 'ssh-ed25519 AAAA... test@example.com')).to.be.true
      expect(result.action).to.equal('add')
      expect(result.key.id).to.equal(FAKE_KEY.id)
      expect(result.key.fingerprint).to.equal(FAKE_KEY.fingerprint)
    })

    it('list action calls service.listKeys and returns mapped keys', async () => {
      const {getRequestHandler, signingKeyService} = makeHandlerWithInjectedService(sandbox)

      const result = await getRequestHandler()(
        {action: 'list'},
        'client-1',
      ) as {action: string; keys: SigningKeyItem[]}

      expect(signingKeyService.listKeys.calledOnce).to.be.true
      expect(result.action).to.equal('list')
      expect(result.keys).to.have.length(1)
      expect(result.keys[0].id).to.equal(FAKE_KEY.id)
    })

    it('remove action calls service.removeKey with keyId', async () => {
      const {getRequestHandler, signingKeyService} = makeHandlerWithInjectedService(sandbox)

      const result = await getRequestHandler()(
        {action: 'remove', keyId: 'key-id-1'},
        'client-1',
      ) as {action: string}

      expect(signingKeyService.removeKey.calledOnce).to.be.true
      expect(signingKeyService.removeKey.calledWith('key-id-1')).to.be.true
      expect(result.action).to.equal('remove')
    })

    it('still enforces auth guard even when service is injected', async () => {
      const requestHandlers: Record<string, RequestHandler> = {}
      const signingKeyService: Stubbed<ISigningKeyService> = {
        addKey: sandbox.stub().resolves(FAKE_KEY),
        listKeys: sandbox.stub().resolves([FAKE_KEY]),
        removeKey: sandbox.stub().resolves(),
      }
      const tokenStore: Stubbed<ITokenStore> = {
        clear: sandbox.stub().resolves(),
        load: sandbox.stub().resolves(),  // no token
        save: sandbox.stub().resolves(),
      }
      const transport: Stubbed<ITransportServer> = {
        broadcastToProject: sandbox.stub(),
        close: sandbox.stub().resolves(),
        emitToClient: sandbox.stub(),
        emitToProject: sandbox.stub(),
        initialize: sandbox.stub().resolves(),
        offRequest: sandbox.stub(),
        onRequest: sandbox.stub().callsFake((event: string, h: RequestHandler) => {
          requestHandlers[event] = h
        }),
      } as unknown as Stubbed<ITransportServer>

      const handler = new SigningKeyHandler({
        iamBaseUrl: IAM_BASE_URL,
        signingKeyService,
        tokenStore,
        transport,
      })
      handler.setup()

      try {
        await requestHandlers[VcEvents.SIGNING_KEY]({action: 'list'}, 'client-1')
        expect.fail('Expected NotAuthenticatedError')
      } catch (error) {
        expect(error).to.be.instanceOf(NotAuthenticatedError)
        expect(signingKeyService.listKeys.called).to.be.false
      }
    })
  })
})
