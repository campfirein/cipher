import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {IAuthService} from '../../../../../src/server/core/interfaces/auth/i-auth-service.js'
import type {ICallbackHandler} from '../../../../../src/server/core/interfaces/auth/i-callback-handler.js'
import type {ITokenStore} from '../../../../../src/server/core/interfaces/auth/i-token-store.js'
import type {IBrowserLauncher} from '../../../../../src/server/core/interfaces/services/i-browser-launcher.js'
import type {IUserService} from '../../../../../src/server/core/interfaces/services/i-user-service.js'
import type {IAuthStateStore} from '../../../../../src/server/core/interfaces/state/i-auth-state-store.js'
import type {IProjectConfigStore} from '../../../../../src/server/core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {AuthToken} from '../../../../../src/server/core/domain/entities/auth-token.js'
import {BrvConfig} from '../../../../../src/server/core/domain/entities/brv-config.js'
import {User} from '../../../../../src/server/core/domain/entities/user.js'
import {AuthHandler, type AuthHandlerDeps} from '../../../../../src/server/infra/transport/handlers/auth-handler.js'
import {AuthEvents} from '../../../../../src/shared/transport/events/auth-events.js'

// ==================== Test Helpers ====================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (data: any, clientId: string) => any
type AuthChangedCallback = (token: AuthToken | undefined) => void
type AuthExpiredCallback = (token: AuthToken) => void

function createMockTransport(): SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>} {
  const handlers = new Map<string, AnyHandler>()
  return {
    _handlers: handlers,
    addToRoom: stub(),
    broadcast: stub(),
    broadcastTo: stub(),
    getPort: stub(),
    isRunning: stub(),
    onConnection: stub(),
    onDisconnection: stub(),
    onRequest: stub().callsFake((event: string, handler: AnyHandler) => {
      handlers.set(event, handler)
    }),
    removeFromRoom: stub(),
    sendTo: stub(),
    start: stub(),
    stop: stub(),
  } as unknown as SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>}
}

function createValidToken(): AuthToken {
  return new AuthToken({
    accessToken: 'test-access-token',
    expiresAt: new Date(Date.now() + 3_600_000), // 1 hour from now
    refreshToken: 'test-refresh-token',
    sessionKey: 'test-session-key',
    tokenType: 'Bearer',
    userEmail: 'test@example.com',
    userId: 'user-123',
  })
}

function createTestUser(): User {
  return new User({
    email: 'test@example.com',
    hasOnboardedCli: true,
    id: 'user-123',
    name: 'Test User',
  })
}

function createTestBrvConfig(): BrvConfig {
  return new BrvConfig({
    createdAt: '2026-01-01T00:00:00.000Z',
    spaceId: 'space-1',
    spaceName: 'Test Space',
    teamId: 'team-1',
    teamName: 'Test Team',
    version: '2',
  })
}

// ==================== Tests ====================

describe('AuthHandler — setupExternalAuthSync', () => {
  let transport: ReturnType<typeof createMockTransport>
  let authStateStore: SinonStubbedInstance<IAuthStateStore>
  let userService: SinonStubbedInstance<IUserService>
  let projectConfigStore: SinonStubbedInstance<IProjectConfigStore>
  let capturedAuthChanged: AuthChangedCallback | undefined
  let capturedAuthExpired: AuthExpiredCallback | undefined

  beforeEach(() => {
    transport = createMockTransport()

    authStateStore = {
      getToken: stub(),
      loadToken: stub().resolves(),
      onAuthChanged: stub().callsFake((cb: AuthChangedCallback) => {
        capturedAuthChanged = cb
      }),
      onAuthExpired: stub().callsFake((cb: AuthExpiredCallback) => {
        capturedAuthExpired = cb
      }),
      startPolling: stub(),
      stopPolling: stub(),
    } as unknown as SinonStubbedInstance<IAuthStateStore>

    userService = {
      getCurrentUser: stub().resolves(createTestUser()),
      updateUser: stub().resolves(),
    } as unknown as SinonStubbedInstance<IUserService>

    projectConfigStore = {
      exists: stub().resolves(true),
      getModifiedTime: stub().resolves(Date.now()),
      read: stub().resolves(createTestBrvConfig()),
      write: stub().resolves(),
    } as unknown as SinonStubbedInstance<IProjectConfigStore>

    capturedAuthChanged = capturedAuthExpired = undefined // eslint-disable-line no-multi-assign
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): void {
    const deps: AuthHandlerDeps = {
      authService: {
        exchangeCodeForToken: stub(),
        initiateAuthorization: stub(),
        refreshToken: stub(),
      } as unknown as IAuthService,
      authStateStore,
      browserLauncher: {open: stub()} as unknown as IBrowserLauncher,
      callbackHandler: {
        getPort: stub().returns(3000),
        start: stub().resolves(),
        stop: stub().resolves(),
        waitForCallback: stub().resolves({code: 'test'}),
      } as unknown as ICallbackHandler,
      projectConfigStore,
      resolveProjectPath: stub().returns('/test/project'),
      tokenStore: {
        clear: stub().resolves(),
        load: stub().resolves(),
        save: stub().resolves(),
      } as unknown as ITokenStore,
      transport,
      userService,
    }
    new AuthHandler(deps).setup()
  }

  describe('callback registration', () => {
    it('should register onAuthChanged callback during setup', () => {
      createHandler()
      expect(authStateStore.onAuthChanged.calledOnce).to.be.true
      expect(capturedAuthChanged).to.be.a('function')
    })

    it('should register onAuthExpired callback during setup', () => {
      createHandler()
      expect(authStateStore.onAuthExpired.calledOnce).to.be.true
      expect(capturedAuthExpired).to.be.a('function')
    })
  })

  describe('onAuthChanged — valid token', () => {
    it('should broadcast auth:updated for agents', () => {
      createHandler()
      const token = createValidToken()

      capturedAuthChanged!(token)

      expect(transport.broadcast.calledWith(AuthEvents.UPDATED)).to.be.true
      const [, payload] = transport.broadcast.getCalls().find((c) => c.args[0] === AuthEvents.UPDATED)!.args
      expect(payload).to.deep.equal({
        hasToken: true,
        isValid: true,
        sessionKey: 'test-session-key',
      })
    })

    it('should broadcast auth:stateChanged with user info (no brvConfig) for TUI', async () => {
      createHandler()
      const token = createValidToken()

      capturedAuthChanged!(token)

      // Wait for async broadcastAuthStateChanged to complete
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      const stateChangedCall = transport.broadcast.getCalls().find((c) => c.args[0] === AuthEvents.STATE_CHANGED)
      expect(stateChangedCall, 'auth:stateChanged should be broadcast').to.exist
      expect(stateChangedCall!.args[1]).to.deep.equal({
        isAuthorized: true,
        user: {email: 'test@example.com', hasOnboardedCli: true, id: 'user-123', name: 'Test User'},
      })
    })

    it('should not include brvConfig in auth:stateChanged broadcast', async () => {
      createHandler()
      const token = createValidToken()

      capturedAuthChanged!(token)

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      const stateChangedCall = transport.broadcast.getCalls().find((c) => c.args[0] === AuthEvents.STATE_CHANGED)
      expect(stateChangedCall).to.exist
      expect(stateChangedCall!.args[1]).to.not.have.property('brvConfig')
    })
  })

  describe('onAuthChanged — undefined token (logout)', () => {
    it('should broadcast auth:updated with hasToken=false', () => {
      createHandler()

      // eslint-disable-next-line unicorn/no-useless-undefined -- undefined simulates logout
      capturedAuthChanged!(undefined)

      const updatedCall = transport.broadcast.getCalls().find((c) => c.args[0] === AuthEvents.UPDATED)
      expect(updatedCall).to.exist
      expect(updatedCall!.args[1]).to.deep.equal({
        hasToken: false,
        isValid: false,
        sessionKey: undefined,
      })
    })

    it('should broadcast auth:stateChanged with isAuthorized=false', async () => {
      createHandler()

      // eslint-disable-next-line unicorn/no-useless-undefined -- undefined simulates logout
      capturedAuthChanged!(undefined)

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      const stateChangedCall = transport.broadcast.getCalls().find((c) => c.args[0] === AuthEvents.STATE_CHANGED)
      expect(stateChangedCall).to.exist
      expect(stateChangedCall!.args[1]).to.deep.equal({isAuthorized: false})
    })
  })

  describe('onAuthChanged — userService failure', () => {
    it('should broadcast auth:stateChanged with isAuthorized=true but no user on network error', async () => {
      userService.getCurrentUser.rejects(new Error('Network error'))
      createHandler()
      const token = createValidToken()

      capturedAuthChanged!(token)

      // auth:updated should be broadcast immediately (sync)
      const updatedCall = transport.broadcast.getCalls().find((c) => c.args[0] === AuthEvents.UPDATED)
      expect(updatedCall).to.exist

      // Wait for async broadcastAuthStateChanged to complete (fallback path)
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })

      // auth:stateChanged should still broadcast with isAuthorized=true (fallback without user)
      const stateChangedCall = transport.broadcast.getCalls().find((c) => c.args[0] === AuthEvents.STATE_CHANGED)
      expect(stateChangedCall, 'auth:stateChanged should be broadcast even on error').to.exist
      expect(stateChangedCall!.args[1]).to.deep.equal({isAuthorized: true})
    })
  })

  describe('setupStartLogin — browser launch behavior', () => {
    let browserOpenStub: ReturnType<typeof stub>

    function createHandlerWithBrowserStub(): void {
      browserOpenStub = stub().resolves()
      const deps: AuthHandlerDeps = {
        authService: {
          exchangeCodeForToken: stub(),
          initiateAuthorization: stub().returns({authUrl: 'https://byterover.dev/oauth/authorize?x=1', state: 'st'}),
          refreshToken: stub(),
        } as unknown as IAuthService,
        authStateStore,
        browserLauncher: {open: browserOpenStub} as unknown as IBrowserLauncher,
        callbackHandler: {
          getPort: stub().returns(3000),
          start: stub().resolves(),
          stop: stub().resolves(),
          waitForCallback: stub().resolves({code: 'test'}),
        } as unknown as ICallbackHandler,
        projectConfigStore,
        resolveProjectPath: stub().returns('/test/project'),
        tokenStore: {
          clear: stub().resolves(),
          load: stub().resolves(),
          save: stub().resolves(),
        } as unknown as ITokenStore,
        transport,
        userService,
      }
      new AuthHandler(deps).setup()
    }

    it('opens the system browser by default (request omitted)', async () => {
      createHandlerWithBrowserStub()
      const handler = transport._handlers.get(AuthEvents.START_LOGIN)!
      await handler(undefined, 'client-1')
      expect(browserOpenStub.calledOnce).to.be.true
    })

    it('opens the system browser when skipBrowserLaunch is false', async () => {
      createHandlerWithBrowserStub()
      const handler = transport._handlers.get(AuthEvents.START_LOGIN)!
      await handler({skipBrowserLaunch: false}, 'client-1')
      expect(browserOpenStub.calledOnce).to.be.true
    })

    it('does NOT open the system browser when skipBrowserLaunch is true', async () => {
      createHandlerWithBrowserStub()
      const handler = transport._handlers.get(AuthEvents.START_LOGIN)!
      const response = await handler({skipBrowserLaunch: true}, 'client-1')
      expect(browserOpenStub.called).to.be.false
      expect(response).to.have.property('authUrl', 'https://byterover.dev/oauth/authorize?x=1')
    })
  })

  describe('onAuthExpired', () => {
    it('should broadcast auth:expired for agents', () => {
      createHandler()
      const token = createValidToken()

      capturedAuthExpired!(token)

      const expiredCall = transport.broadcast.getCalls().find((c) => c.args[0] === AuthEvents.EXPIRED)
      expect(expiredCall).to.exist
      expect(expiredCall!.args[1]).to.deep.equal({})
    })

    it('should broadcast auth:stateChanged with isAuthorized=false for TUI', () => {
      createHandler()
      const token = createValidToken()

      capturedAuthExpired!(token)

      const stateChangedCall = transport.broadcast.getCalls().find((c) => c.args[0] === AuthEvents.STATE_CHANGED)
      expect(stateChangedCall).to.exist
      expect(stateChangedCall!.args[1]).to.deep.equal({isAuthorized: false})
    })
  })
})
