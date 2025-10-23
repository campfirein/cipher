# Login Command Implementation Guide

This guide provides step-by-step implementation details for the login command following the plan in [Login Command Implementation Plan.md](Login Command Implementation Plan.md).

## Phase 1: Setup & Configuration

### Step 1.1: Install Dependencies

```bash
npm install open axios express nanoid
npm install --save-dev nock sinon tmp @types/express @types/sinon
```

### Step 1.2: Auth Configuration

Create the auth configuration file:

```typescript
// filepath: src/config/auth.config.ts
export interface OAuthConfig {
  clientId: string
  clientSecret?: string
  authorizationUrl: string
  tokenUrl: string
  redirectUri: string
  scopes: string[]
}

export function getAuthConfig(): OAuthConfig {
  const clientId = process.env.BR_CLIENT_ID
  const clientSecret = process.env.BR_CLIENT_SECRET
  const authorizationUrl = process.env.BR_AUTH_URL || 'https://auth.byterover.com/oauth/authorize'
  const tokenUrl = process.env.BR_TOKEN_URL || 'https://auth.byterover.com/oauth/token'
  const scopes = (process.env.BR_SCOPES || 'read write').split(' ')

  if (!clientId) {
    throw new Error('BR_CLIENT_ID environment variable is required')
  }

  return {
    authorizationUrl,
    clientId,
    clientSecret,
    redirectUri: 'http://localhost:0/callback',
    scopes,
  }
}
```

## Phase 2: Domain Layer

### Step 2.1: AuthToken Entity (TDD)

First, write the test:

```typescript
// filepath: test/unit/core/domain/entities/AuthToken.test.ts
import {expect} from 'chai'
import {AuthToken} from '../../../../../src/core/domain/entities/AuthToken.js'

describe('AuthToken', () => {
  describe('isExpired', () => {
    it('should return false for non-expired token', () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000) // 1 hour from now
      const token = new AuthToken('access-token', 'refresh-token', expiresAt, 'Bearer')
      expect(token.isExpired()).to.be.false
    })

    it('should return true for expired token', () => {
      const expiresAt = new Date(Date.now() - 1000) // 1 second ago
      const token = new AuthToken('access-token', 'refresh-token', expiresAt, 'Bearer')
      expect(token.isExpired()).to.be.true
    })

    it('should return true for token expiring now', () => {
      const expiresAt = new Date()
      const token = new AuthToken('access-token', 'refresh-token', expiresAt, 'Bearer')
      expect(token.isExpired()).to.be.true
    })
  })

  describe('isValid', () => {
    it('should return true for valid non-expired token', () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000)
      const token = new AuthToken('access-token', 'refresh-token', expiresAt, 'Bearer')
      expect(token.isValid()).to.be.true
    })

    it('should return false for expired token', () => {
      const expiresAt = new Date(Date.now() - 1000)
      const token = new AuthToken('access-token', 'refresh-token', expiresAt, 'Bearer')
      expect(token.isValid()).to.be.false
    })

    it('should return false for token without access token', () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000)
      const token = new AuthToken('', 'refresh-token', expiresAt, 'Bearer')
      expect(token.isValid()).to.be.false
    })
  })

  describe('toJSON', () => {
    it('should serialize token to JSON', () => {
      const expiresAt = new Date('2024-12-31T23:59:59.000Z')
      const token = new AuthToken('access-token', 'refresh-token', expiresAt, 'Bearer')
      const json = token.toJSON()

      expect(json).to.deep.equal({
        accessToken: 'access-token',
        expiresAt: '2024-12-31T23:59:59.000Z',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
      })
    })
  })

  describe('fromJSON', () => {
    it('should deserialize token from JSON', () => {
      const json = {
        accessToken: 'access-token',
        expiresAt: '2024-12-31T23:59:59.000Z',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
      }

      const token = AuthToken.fromJSON(json)

      expect(token.accessToken).to.equal('access-token')
      expect(token.refreshToken).to.equal('refresh-token')
      expect(token.expiresAt.toISOString()).to.equal('2024-12-31T23:59:59.000Z')
      expect(token.tokenType).to.equal('Bearer')
    })
  })
})
```

Now implement the entity:

```typescript
// filepath: src/core/domain/entities/AuthToken.ts
export class AuthToken {
  constructor(
    public readonly accessToken: string,
    public readonly refreshToken: string,
    public readonly expiresAt: Date,
    public readonly tokenType: string = 'Bearer',
  ) {}

  isExpired(): boolean {
    return this.expiresAt <= new Date()
  }

  isValid(): boolean {
    return Boolean(this.accessToken) && !this.isExpired()
  }

  toJSON(): Record<string, string> {
    return {
      accessToken: this.accessToken,
      expiresAt: this.expiresAt.toISOString(),
      refreshToken: this.refreshToken,
      tokenType: this.tokenType,
    }
  }

  static fromJSON(json: Record<string, string>): AuthToken {
    return new AuthToken(
      json.accessToken,
      json.refreshToken,
      new Date(json.expiresAt),
      json.tokenType,
    )
  }
}
```

### Step 2.2: User Entity (TDD)

Write the test:

```typescript
// filepath: test/unit/core/domain/entities/User.test.ts
import {expect} from 'chai'
import {User} from '../../../../../src/core/domain/entities/User.js'

describe('User', () => {
  describe('constructor', () => {
    it('should create a user with all properties', () => {
      const user = new User('123', 'test@example.com', 'Test User')

      expect(user.id).to.equal('123')
      expect(user.email).to.equal('test@example.com')
      expect(user.name).to.equal('Test User')
    })
  })

  describe('toJSON', () => {
    it('should serialize user to JSON', () => {
      const user = new User('123', 'test@example.com', 'Test User')
      const json = user.toJSON()

      expect(json).to.deep.equal({
        email: 'test@example.com',
        id: '123',
        name: 'Test User',
      })
    })
  })

  describe('fromJSON', () => {
    it('should deserialize user from JSON', () => {
      const json = {
        email: 'test@example.com',
        id: '123',
        name: 'Test User',
      }

      const user = User.fromJSON(json)

      expect(user.id).to.equal('123')
      expect(user.email).to.equal('test@example.com')
      expect(user.name).to.equal('Test User')
    })
  })
})
```

Implement the entity:

```typescript
// filepath: src/core/domain/entities/User.ts
export class User {
  constructor(
    public readonly id: string,
    public readonly email: string,
    public readonly name: string,
  ) {}

  toJSON(): Record<string, string> {
    return {
      email: this.email,
      id: this.id,
      name: this.name,
    }
  }

  static fromJSON(json: Record<string, string>): User {
    return new User(json.id, json.email, json.name)
  }
}
```

### Step 2.3: Custom Errors

```typescript
// filepath: src/core/domain/errors/AuthError.ts
export class AuthenticationError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class TokenExpiredError extends Error {
  constructor(message = 'Token has expired') {
    super(message)
    this.name = 'TokenExpiredError'
  }
}

export class InvalidTokenError extends Error {
  constructor(message = 'Token is invalid') {
    super(message)
    this.name = 'InvalidTokenError'
  }
}
```

## Phase 3: Core Interfaces

### Step 3.1: Define Contracts

```typescript
// filepath: src/core/interfaces/IAuthService.ts
import {AuthToken} from '../domain/entities/AuthToken.js'

export interface IAuthService {
  getAuthorizationUrl(state: string, codeVerifier: string): string
  exchangeCodeForToken(code: string, codeVerifier: string): Promise<AuthToken>
  refreshToken(refreshToken: string): Promise<AuthToken>
}
```

```typescript
// filepath: src/core/interfaces/ITokenStore.ts
import {AuthToken} from '../domain/entities/AuthToken.js'

export interface ITokenStore {
  save(token: AuthToken): Promise<void>
  load(): Promise<AuthToken | null>
  clear(): Promise<void>
}
```

```typescript
// filepath: src/core/interfaces/IBrowserLauncher.ts
export interface IBrowserLauncher {
  open(url: string): Promise<void>
}
```

## Phase 4: Learning Tests

### Step 4.1: OAuth Flow Learning Test

```typescript
// filepath: test/learning/oauth/authorization-code-flow.test.ts
import {expect} from 'chai'
import crypto from 'node:crypto'

describe('OAuth Authorization Code Flow - Learning Tests', () => {
  describe('PKCE Code Generation', () => {
    it('should generate a random code verifier', () => {
      const codeVerifier = crypto.randomBytes(32).toString('base64url')

      expect(codeVerifier).to.have.lengthOf.at.least(43)
      expect(codeVerifier).to.have.lengthOf.at.most(128)
    })

    it('should generate SHA256 code challenge from verifier', () => {
      const codeVerifier = 'test-verifier-1234567890-abcdefghijklmnop'
      const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

      expect(hash).to.be.a('string')
      expect(hash).to.have.lengthOf(43)
    })

    it('should generate different challenges for different verifiers', () => {
      const verifier1 = crypto.randomBytes(32).toString('base64url')
      const verifier2 = crypto.randomBytes(32).toString('base64url')

      const challenge1 = crypto.createHash('sha256').update(verifier1).digest('base64url')
      const challenge2 = crypto.createHash('sha256').update(verifier2).digest('base64url')

      expect(challenge1).to.not.equal(challenge2)
    })
  })

  describe('State Parameter Generation', () => {
    it('should generate a random state parameter', () => {
      const state = crypto.randomBytes(16).toString('base64url')

      expect(state).to.be.a('string')
      expect(state.length).to.be.at.least(20)
    })
  })

  describe('Authorization URL Construction', () => {
    it('should build authorization URL with required parameters', () => {
      const baseUrl = 'https://auth.example.com/oauth/authorize'
      const params = new URLSearchParams({
        client_id: 'test-client-id',
        code_challenge: 'test-challenge',
        code_challenge_method: 'S256',
        redirect_uri: 'http://localhost:3000/callback',
        response_type: 'code',
        scope: 'read write',
        state: 'test-state',
      })

      const authUrl = `${baseUrl}?${params.toString()}`

      expect(authUrl).to.include('client_id=test-client-id')
      expect(authUrl).to.include('response_type=code')
      expect(authUrl).to.include('code_challenge=test-challenge')
      expect(authUrl).to.include('code_challenge_method=S256')
      expect(authUrl).to.include('state=test-state')
    })
  })
})
```

### Step 4.2: HTTP Server Learning Test

```typescript
// filepath: test/learning/http/local-server.test.ts
import {expect} from 'chai'
import express from 'express'
import type {Server} from 'node:http'

describe('Local HTTP Server - Learning Tests', () => {
  let server: Server

  afterEach((done) => {
    if (server) {
      server.close(done)
    } else {
      done()
    }
  })

  it('should create server on random available port', (done) => {
    const app = express()

    server = app.listen(0, () => {
      const address = server.address()
      if (address && typeof address !== 'string') {
        expect(address.port).to.be.greaterThan(0)
        done()
      }
    })
  })

  it('should handle GET /callback route', (done) => {
    const app = express()
    let callbackReceived = false

    app.get('/callback', (req, res) => {
      callbackReceived = true
      res.send('OK')
    })

    server = app.listen(0, () => {
      const address = server.address()
      if (address && typeof address !== 'string') {
        const port = address.port

        // Simulate callback
        fetch(`http://localhost:${port}/callback?code=test-code&state=test-state`)
          .then(() => {
            expect(callbackReceived).to.be.true
            done()
          })
          .catch(done)
      }
    })
  })

  it('should extract query parameters from callback', (done) => {
    const app = express()
    let receivedCode: string | undefined
    let receivedState: string | undefined

    app.get('/callback', (req, res) => {
      receivedCode = req.query.code as string
      receivedState = req.query.state as string
      res.send('OK')
    })

    server = app.listen(0, () => {
      const address = server.address()
      if (address && typeof address !== 'string') {
        const port = address.port

        fetch(`http://localhost:${port}/callback?code=auth-code-123&state=state-456`)
          .then(() => {
            expect(receivedCode).to.equal('auth-code-123')
            expect(receivedState).to.equal('state-456')
            done()
          })
          .catch(done)
      }
    })
  })
})
```

## Phase 5: Infrastructure Layer

### Step 5.1: OAuthService Implementation (TDD)

First, write the test:

```typescript
// filepath: test/unit/infrastructure/auth/OAuthService.test.ts
import {expect} from 'chai'
import nock from 'nock'
import sinon from 'sinon'
import {OAuthService} from '../../../../src/infrastructure/auth/OAuthService.js'
import type {OAuthConfig} from '../../../../src/config/auth.config.js'

describe('OAuthService', () => {
  let service: OAuthService
  let config: OAuthConfig

  beforeEach(() => {
    config = {
      authorizationUrl: 'https://auth.example.com/oauth/authorize',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/callback',
      scopes: ['read', 'write'],
      tokenUrl: 'https://auth.example.com/oauth/token',
    }
    service = new OAuthService(config)
  })

  afterEach(() => {
    nock.cleanAll()
    sinon.restore()
  })

  describe('getAuthorizationUrl', () => {
    it('should build authorization URL with PKCE parameters', () => {
      const state = 'test-state'
      const codeVerifier = 'test-verifier'

      const url = service.getAuthorizationUrl(state, codeVerifier)

      expect(url).to.include('https://auth.example.com/oauth/authorize')
      expect(url).to.include('client_id=test-client-id')
      expect(url).to.include('response_type=code')
      expect(url).to.include('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback')
      expect(url).to.include('scope=read+write')
      expect(url).to.include('state=test-state')
      expect(url).to.include('code_challenge_method=S256')
      expect(url).to.include('code_challenge=')
    })
  })

  describe('exchangeCodeForToken', () => {
    it('should exchange authorization code for access token', async () => {
      const code = 'auth-code-123'
      const codeVerifier = 'test-verifier'

      nock('https://auth.example.com')
        .post('/oauth/token', {
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          code: 'auth-code-123',
          code_verifier: 'test-verifier',
          grant_type: 'authorization_code',
          redirect_uri: 'http://localhost:3000/callback',
        })
        .reply(200, {
          access_token: 'access-token-123',
          expires_in: 3600,
          refresh_token: 'refresh-token-456',
          token_type: 'Bearer',
        })

      const token = await service.exchangeCodeForToken(code, codeVerifier)

      expect(token.accessToken).to.equal('access-token-123')
      expect(token.refreshToken).to.equal('refresh-token-456')
      expect(token.tokenType).to.equal('Bearer')
      expect(token.isValid()).to.be.true
    })

    it('should throw error on failed token exchange', async () => {
      nock('https://auth.example.com')
        .post('/oauth/token')
        .reply(400, {error: 'invalid_grant'})

      try {
        await service.exchangeCodeForToken('invalid-code', 'verifier')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
      }
    })
  })

  describe('refreshToken', () => {
    it('should refresh access token using refresh token', async () => {
      const refreshToken = 'refresh-token-456'

      nock('https://auth.example.com')
        .post('/oauth/token', {
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          grant_type: 'refresh_token',
          refresh_token: 'refresh-token-456',
        })
        .reply(200, {
          access_token: 'new-access-token',
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
          token_type: 'Bearer',
        })

      const token = await service.refreshToken(refreshToken)

      expect(token.accessToken).to.equal('new-access-token')
      expect(token.refreshToken).to.equal('new-refresh-token')
    })
  })
})
```

Now implement the service:

```typescript
// filepath: src/infrastructure/auth/OAuthService.ts
import axios from 'axios'
import crypto from 'node:crypto'
import {AuthToken} from '../../core/domain/entities/AuthToken.js'
import {AuthenticationError} from '../../core/domain/errors/AuthError.js'
import type {IAuthService} from '../../core/interfaces/IAuthService.js'
import type {OAuthConfig} from '../../config/auth.config.js'

export class OAuthService implements IAuthService {
  constructor(private readonly config: OAuthConfig) {}

  getAuthorizationUrl(state: string, codeVerifier: string): string {
    const codeChallenge = this.generateCodeChallenge(codeVerifier)

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
    })

    return `${this.config.authorizationUrl}?${params.toString()}`
  }

  async exchangeCodeForToken(code: string, codeVerifier: string): Promise<AuthToken> {
    try {
      const response = await axios.post(this.config.tokenUrl, {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: this.config.redirectUri,
      })

      return this.parseTokenResponse(response.data)
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new AuthenticationError(
          error.response?.data?.error_description || 'Failed to exchange code for token',
          error.response?.data?.error,
        )
      }

      throw error
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthToken> {
    try {
      const response = await axios.post(this.config.tokenUrl, {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })

      return this.parseTokenResponse(response.data)
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new AuthenticationError(
          error.response?.data?.error_description || 'Failed to refresh token',
          error.response?.data?.error,
        )
      }

      throw error
    }
  }

  private generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url')
  }

  private parseTokenResponse(data: any): AuthToken {
    const expiresAt = new Date(Date.now() + data.expires_in * 1000)
    return new AuthToken(data.access_token, data.refresh_token, expiresAt, data.token_type)
  }
}
```

### Step 5.2: CallbackServer Implementation (TDD)

Test first:

```typescript
// filepath: test/unit/infrastructure/http/CallbackServer.test.ts
import {expect} from 'chai'
import {CallbackServer} from '../../../../src/infrastructure/http/CallbackServer.js'

describe('CallbackServer', () => {
  let server: CallbackServer

  afterEach(async () => {
    if (server) {
      await server.stop()
    }
  })

  describe('start', () => {
    it('should start server on random port', async () => {
      server = new CallbackServer()
      const port = await server.start()

      expect(port).to.be.greaterThan(0)
    })

    it('should return port when server is started', async () => {
      server = new CallbackServer()
      const port = await server.start()
      const address = server.getAddress()

      expect(address?.port).to.equal(port)
    })
  })

  describe('waitForCallback', () => {
    it('should resolve when callback is received', async () => {
      server = new CallbackServer()
      const port = await server.start()

      const callbackPromise = server.waitForCallback('test-state', 5000)

      // Simulate OAuth callback
      await fetch(`http://localhost:${port}/callback?code=auth-code&state=test-state`)

      const result = await callbackPromise

      expect(result.code).to.equal('auth-code')
      expect(result.state).to.equal('test-state')
    })

    it('should reject on timeout', async () => {
      server = new CallbackServer()
      await server.start()

      try {
        await server.waitForCallback('test-state', 100)
        expect.fail('Should have timed out')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('timeout')
      }
    })

    it('should reject on state mismatch', async () => {
      server = new CallbackServer()
      const port = await server.start()

      const callbackPromise = server.waitForCallback('expected-state', 5000)

      await fetch(`http://localhost:${port}/callback?code=auth-code&state=wrong-state`)

      try {
        await callbackPromise
        expect.fail('Should have rejected')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('state')
      }
    })
  })

  describe('stop', () => {
    it('should stop the server', async () => {
      server = new CallbackServer()
      await server.start()
      await server.stop()

      const address = server.getAddress()
      expect(address).to.be.null
    })
  })
})
```

Implementation:

```typescript
// filepath: src/infrastructure/http/CallbackServer.ts
import express from 'express'
import type {Server} from 'node:http'
import {AuthenticationError} from '../../core/domain/errors/AuthError.js'

interface CallbackResult {
  code: string
  state: string
}

export class CallbackServer {
  private server: Server | null = null
  private app = express()

  constructor() {
    this.setupRoutes()
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(0, () => {
        const address = this.server?.address()
        if (address && typeof address !== 'string') {
          resolve(address.port)
        } else {
          reject(new Error('Failed to start server'))
        }
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  getAddress(): {port: number} | null {
    const address = this.server?.address()
    if (address && typeof address !== 'string') {
      return {port: address.port}
    }

    return null
  }

  waitForCallback(expectedState: string, timeoutMs: number): Promise<CallbackResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new AuthenticationError('Authentication timeout - no callback received'))
      }, timeoutMs)

      this.app.locals.onCallback = (code: string, state: string) => {
        clearTimeout(timeout)

        if (state !== expectedState) {
          reject(new AuthenticationError('State mismatch - possible CSRF attack'))
          return
        }

        resolve({code, state})
      }

      this.app.locals.onError = (error: string) => {
        clearTimeout(timeout)
        reject(new AuthenticationError(error))
      }
    })
  }

  private setupRoutes(): void {
    this.app.get('/callback', (req, res) => {
      const {code, state, error, error_description} = req.query

      if (error) {
        const errorMessage = error_description || error
        this.app.locals.onError?.(String(errorMessage))
        res.send(this.getErrorPage(String(errorMessage)))
        return
      }

      if (!code || !state) {
        this.app.locals.onError?.('Missing code or state parameter')
        res.send(this.getErrorPage('Missing required parameters'))
        return
      }

      this.app.locals.onCallback?.(String(code), String(state))
      res.send(this.getSuccessPage())
    })
  }

  private getSuccessPage(): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 3rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: #22c55e; margin-bottom: 1rem; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Authentication Successful</h1>
            <p>You can close this window and return to the CLI.</p>
          </div>
          <script>setTimeout(() => window.close(), 3000)</script>
        </body>
      </html>
    `
  }

  private getErrorPage(error: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 3rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: #ef4444; margin-bottom: 1rem; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Authentication Failed</h1>
            <p>${error}</p>
            <p>Please try again or contact support.</p>
          </div>
        </body>
      </html>
    `
  }
}
```

### Step 5.3: KeychainTokenStore Implementation (TDD)

**Note:** This implementation uses OS keychain via `keytar` for secure token storage. This provides better security than file-based storage by leveraging OS-level encryption and access control.

First, install the dependency:

```bash
npm install keytar
```

Test:

```typescript
// filepath: test/unit/infrastructure/storage/KeychainTokenStore.test.ts
import {expect} from 'chai'
import sinon from 'sinon'
import * as keytar from 'keytar'
import {AuthToken} from '../../../../src/core/domain/entities/AuthToken.js'
import {KeychainTokenStore} from '../../../../src/infrastructure/storage/KeychainTokenStore.js'

describe('KeychainTokenStore', () => {
  let store: KeychainTokenStore
  let getPasswordStub: sinon.SinonStub
  let setPasswordStub: sinon.SinonStub
  let deletePasswordStub: sinon.SinonStub

  beforeEach(() => {
    getPasswordStub = sinon.stub(keytar, 'getPassword')
    setPasswordStub = sinon.stub(keytar, 'setPassword')
    deletePasswordStub = sinon.stub(keytar, 'deletePassword')
    store = new KeychainTokenStore()
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('save', () => {
    it('should save token to keychain', async () => {
      const token = new AuthToken(
        'access-token',
        'refresh-token',
        new Date(Date.now() + 3600 * 1000),
        'Bearer',
      )

      setPasswordStub.resolves(undefined)

      await store.save(token)

      expect(setPasswordStub.calledOnce).to.be.true
      expect(setPasswordStub.firstCall.args[0]).to.equal('byterover-cli')
      expect(setPasswordStub.firstCall.args[1]).to.equal('auth-token')
      
      const savedData = JSON.parse(setPasswordStub.firstCall.args[2])
      expect(savedData.accessToken).to.equal('access-token')
      expect(savedData.refreshToken).to.equal('refresh-token')
      expect(savedData.tokenType).to.equal('Bearer')
    })

    it('should handle save errors gracefully', async () => {
      const token = new AuthToken('access', 'refresh', new Date(), 'Bearer')
      setPasswordStub.rejects(new Error('Keychain access denied'))

      try {
        await store.save(token)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Keychain access denied')
      }
    })
  })

  describe('load', () => {
    it('should load saved token from keychain', async () => {
      const tokenData = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: '2025-12-31T23:59:59.000Z',
        tokenType: 'Bearer',
      }

      getPasswordStub.resolves(JSON.stringify(tokenData))

      const loadedToken = await store.load()

      expect(loadedToken).to.not.be.null
      expect(loadedToken?.accessToken).to.equal('access-token')
      expect(loadedToken?.refreshToken).to.equal('refresh-token')
      expect(loadedToken?.tokenType).to.equal('Bearer')
      expect(loadedToken?.expiresAt.toISOString()).to.equal('2025-12-31T23:59:59.000Z')
    })

    it('should return null if token does not exist', async () => {
      getPasswordStub.resolves(null)

      const token = await store.load()
      expect(token).to.be.null
    })

    it('should return null if token data is invalid', async () => {
      getPasswordStub.resolves('invalid-json-data')

      const token = await store.load()
      expect(token).to.be.null
    })

    it('should handle keychain read errors gracefully', async () => {
      getPasswordStub.rejects(new Error('Keychain read error'))

      const token = await store.load()
      expect(token).to.be.null
    })
  })

  describe('clear', () => {
    it('should delete token from keychain', async () => {
      deletePasswordStub.resolves(true)

      await store.clear()

      expect(deletePasswordStub.calledOnce).to.be.true
      expect(deletePasswordStub.firstCall.args[0]).to.equal('byterover-cli')
      expect(deletePasswordStub.firstCall.args[1]).to.equal('auth-token')
    })

    it('should not throw if token does not exist', async () => {
      deletePasswordStub.resolves(false)

      await expect(store.clear()).to.not.be.rejected
    })

    it('should handle deletion errors gracefully', async () => {
      deletePasswordStub.rejects(new Error('Keychain delete error'))

      // Should not throw, just log or ignore
      await expect(store.clear()).to.not.be.rejected
    })
  })
})
```

Implementation:

```typescript
// filepath: src/infrastructure/storage/KeychainTokenStore.ts
import * as keytar from 'keytar'
import {AuthToken} from '../../core/domain/entities/AuthToken.js'
import type {ITokenStore} from '../../core/interfaces/ITokenStore.js'

const SERVICE_NAME = 'byterover-cli'
const ACCOUNT_NAME = 'auth-token'

export class KeychainTokenStore implements ITokenStore {
  async save(token: AuthToken): Promise<void> {
    try {
      const data = JSON.stringify(token.toJSON())
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, data)
    } catch (error) {
      throw new Error(
        `Failed to save token to keychain: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async load(): Promise<AuthToken | null> {
    try {
      const data = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME)
      
      if (!data) {
        return null
      }

      const parsed = JSON.parse(data)
      return AuthToken.fromJSON(parsed)
    } catch (error) {
      // Return null on any error (missing token, invalid JSON, keychain errors)
      return null
    }
  }

  async clear(): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME)
    } catch {
      // Ignore errors - token might not exist or keychain might be unavailable
    }
  }
}
```

#### Security Considerations

**Benefits of using `keytar` over file-based storage:**

1. **OS-level encryption:** Leverages macOS Keychain, Windows Credential Manager, or Linux Secret Service
2. **Better access control:** Protected by OS security features and user authentication
3. **No key management:** No need to derive/store encryption keys yourself
4. **Industry standard:** Used by VS Code, GitHub CLI, and other production tools
5. **Protection against disk forensics:** Credentials are better protected if machine is compromised

**Limitations:**

- Requires native dependencies (may complicate installation)
- May not work in headless/CI environments
- Platform-specific behavior differences

**Alternative: Hybrid Approach:**

For maximum compatibility, you can create a factory that tries keychain first and falls back to encrypted file storage:

```typescript
// filepath: src/infrastructure/storage/TokenStoreFactory.ts
import type {ITokenStore} from '../../core/interfaces/ITokenStore.js'

export async function createTokenStore(): Promise<ITokenStore> {
  // Check if user wants to force a specific store type
  const storeType = process.env.BR_TOKEN_STORE || 'auto'
  
  if (storeType === 'file') {
    const {FileTokenStore} = await import('./FileTokenStore.js')
    return new FileTokenStore()
  }
  
  if (storeType === 'keychain') {
    const {KeychainTokenStore} = await import('./KeychainTokenStore.js')
    return new KeychainTokenStore()
  }
  
  // Auto: try keychain first, fallback to file
  try {
    const {KeychainTokenStore} = await import('./KeychainTokenStore.js')
    const store = new KeychainTokenStore()
    
    // Test if keychain is accessible by attempting to load
    await store.load()
    
    return store
  } catch (error) {
    // Keychain not available, use encrypted file storage as fallback
    console.warn('Keychain not available, using encrypted file storage')
    const {FileTokenStore} = await import('./FileTokenStore.js')
    return new FileTokenStore()
  }
}
```

**Usage in Commands:**

```typescript
// In your login command, replace:
// const tokenStore = new FileTokenStore()

// With:
const tokenStore = await createTokenStore()
```

### Step 5.4: SystemBrowserLauncher Implementation (TDD)

Test:

```typescript
// filepath: test/unit/infrastructure/browser/SystemBrowserLauncher.test.ts
import {expect} from 'chai'
import sinon from 'sinon'
import {SystemBrowserLauncher} from '../../../../src/infrastructure/browser/SystemBrowserLauncher.js'

describe('SystemBrowserLauncher', () => {
  let launcher: SystemBrowserLauncher
  let openStub: sinon.SinonStub

  beforeEach(async () => {
    const openModule = await import('open')
    openStub = sinon.stub(openModule, 'default')
    launcher = new SystemBrowserLauncher()
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('open', () => {
    it('should open URL in default browser', async () => {
      openStub.resolves()

      await launcher.open('https://example.com')

      expect(openStub.calledOnce).to.be.true
      expect(openStub.calledWith('https://example.com')).to.be.true
    })

    it('should throw error if browser launch fails', async () => {
      openStub.rejects(new Error('Failed to launch browser'))

      try {
        await launcher.open('https://example.com')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('browser')
      }
    })
  })
})
```

Implementation:

```typescript
// filepath: src/infrastructure/browser/SystemBrowserLauncher.ts
import open from 'open'
import type {IBrowserLauncher} from '../../core/interfaces/IBrowserLauncher.js'

export class SystemBrowserLauncher implements IBrowserLauncher {
  async open(url: string): Promise<void> {
    try {
      await open(url)
    } catch (error) {
      throw new Error(`Failed to launch browser: ${error}`)
    }
  }
}
```

## Phase 6: Use Cases

### Step 6.1: LoginUseCase (TDD)

Test:

```typescript
// filepath: test/unit/core/usecases/LoginUseCase.test.ts
import {expect} from 'chai'
import sinon from 'sinon'
import {AuthToken} from '../../../../src/core/domain/entities/AuthToken.js'
import {LoginUseCase} from '../../../../src/core/usecases/LoginUseCase.js'
import type {IAuthService} from '../../../../src/core/interfaces/IAuthService.js'
import type {IBrowserLauncher} from '../../../../src/core/interfaces/IBrowserLauncher.js'
import type {ITokenStore} from '../../../../src/core/interfaces/ITokenStore.js'

describe('LoginUseCase', () => {
  let useCase: LoginUseCase
  let authService: sinon.SinonStubbedInstance<IAuthService>
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let browserLauncher: sinon.SinonStubbedInstance<IBrowserLauncher>

  beforeEach(() => {
    authService = {
      exchangeCodeForToken: sinon.stub(),
      getAuthorizationUrl: sinon.stub(),
      refreshToken: sinon.stub(),
    }

    tokenStore = {
      clear: sinon.stub(),
      load: sinon.stub(),
      save: sinon.stub(),
    }

    browserLauncher = {
      open: sinon.stub(),
    }

    useCase = new LoginUseCase(authService, tokenStore, browserLauncher)
  })

  describe('execute', () => {
    it('should complete successful login flow', async () => {
      const authUrl = 'https://auth.example.com?code=123'
      const token = new AuthToken('access', 'refresh', new Date(Date.now() + 3600000), 'Bearer')

      authService.getAuthorizationUrl.returns(authUrl)
      browserLauncher.open.resolves()
      authService.exchangeCodeForToken.resolves(token)
      tokenStore.save.resolves()

      const mockCallback = async () => ({code: 'auth-code', state: 'state-123'})

      const result = await useCase.execute(mockCallback)

      expect(result.success).to.be.true
      expect(result.token).to.equal(token)
      expect(browserLauncher.open.calledWith(authUrl)).to.be.true
      expect(tokenStore.save.calledWith(token)).to.be.true
    })

    it('should handle browser launch failure gracefully', async () => {
      authService.getAuthorizationUrl.returns('https://auth.example.com')
      browserLauncher.open.rejects(new Error('Failed to open browser'))

      const mockCallback = async () => ({code: 'auth-code', state: 'state'})

      const result = await useCase.execute(mockCallback)

      expect(result.authUrl).to.equal('https://auth.example.com')
    })

    it('should handle token exchange failure', async () => {
      authService.getAuthorizationUrl.returns('https://auth.example.com')
      browserLauncher.open.resolves()
      authService.exchangeCodeForToken.rejects(new Error('Invalid code'))

      const mockCallback = async () => ({code: 'invalid-code', state: 'state'})

      try {
        await useCase.execute(mockCallback)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.an('error')
      }
    })
  })
})
```

Implementation:

```typescript
// filepath: src/core/usecases/LoginUseCase.ts
import crypto from 'node:crypto'
import type {AuthToken} from '../domain/entities/AuthToken.js'
import type {IAuthService} from '../interfaces/IAuthService.js'
import type {IBrowserLauncher} from '../interfaces/IBrowserLauncher.js'
import type {ITokenStore} from '../interfaces/ITokenStore.js'

interface LoginResult {
  success: boolean
  token?: AuthToken
  authUrl?: string
  error?: string
}

type CallbackFunction = () => Promise<{code: string; state: string}>

export class LoginUseCase {
  constructor(
    private readonly authService: IAuthService,
    private readonly tokenStore: ITokenStore,
    private readonly browserLauncher: IBrowserLauncher,
  ) {}

  async execute(getCallback: CallbackFunction): Promise<LoginResult> {
    // Generate PKCE parameters
    const codeVerifier = this.generateCodeVerifier()
    const state = this.generateState()

    // Build authorization URL
    const authUrl = this.authService.getAuthorizationUrl(state, codeVerifier)

    // Try to open browser
    let browserOpened = false
    try {
      await this.browserLauncher.open(authUrl)
      browserOpened = true
    } catch {
      // Browser launch failed, will return URL to user
    }

    try {
      // Wait for callback
      const {code} = await getCallback()

      // Exchange code for token
      const token = await this.authService.exchangeCodeForToken(code, codeVerifier)

      // Store token
      await this.tokenStore.save(token)

      return {
        success: true,
        token,
      }
    } catch (error) {
      return {
        authUrl: browserOpened ? undefined : authUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      }
    }
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url')
  }

  private generateState(): string {
    return crypto.randomBytes(16).toString('base64url')
  }
}
```

## Phase 7: Command Implementation

### Step 7.1: Login Command

Integration test:

```typescript
// filepath: test/integration/commands/auth/login.test.ts
import {expect} from 'chai'
import {runCommand} from '@oclif/test'
import nock from 'nock'

describe('login command - integration', () => {
  afterEach(() => {
    nock.cleanAll()
  })

  it('should display help for login command', async () => {
    const {stdout} = await runCommand('auth:login --help')
    expect(stdout).to.include('Authenticate with ByteRover')
  })

  // Note: Full integration test would require mocking OAuth server and browser
  // This is a placeholder for future implementation
})
```

Command implementation:

```typescript
// filepath: src/commands/auth/login.ts
import {Command, Flags, ux} from '@oclif/core'
import {getAuthConfig} from '../../config/auth.config.js'
import {LoginUseCase} from '../../core/usecases/LoginUseCase.js'
import {OAuthService} from '../../infrastructure/auth/OAuthService.js'
import {SystemBrowserLauncher} from '../../infrastructure/browser/SystemBrowserLauncher.js'
import {CallbackServer} from '../../infrastructure/http/CallbackServer.js'
import {FileTokenStore} from '../../infrastructure/storage/FileTokenStore.js'

export default class Login extends Command {
  static description = 'Authenticate with ByteRover'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --no-browser',
  ]

  static flags = {
    browser: Flags.boolean({
      char: 'b',
      default: true,
      description: 'Open browser automatically',
    }),
    timeout: Flags.integer({
      char: 't',
      default: 120,
      description: 'Timeout in seconds',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Login)

    try {
      // Setup dependencies
      const config = getAuthConfig()
      const authService = new OAuthService(config)
      const tokenStore = new FileTokenStore()
      const browserLauncher = new SystemBrowserLauncher()

      const useCase = new LoginUseCase(authService, tokenStore, browserLauncher)

      // Start callback server
      const callbackServer = new CallbackServer()
      const port = await callbackServer.start()

      // Update config with actual port
      config.redirectUri = `http://localhost:${port}/callback`

      ux.action.start('Waiting for authentication')

      // Execute login
      const result = await useCase.execute(async () => {
        const state = Math.random().toString(36).slice(2)
        return callbackServer.waitForCallback(state, flags.timeout * 1000)
      })

      ux.action.stop()

      await callbackServer.stop()

      if (result.success) {
        this.log('✓ Successfully authenticated!')
      } else {
        if (result.authUrl && !flags.browser) {
          this.log('Open this URL in your browser to authenticate:')
          this.log(result.authUrl)
        }

        this.error(result.error || 'Authentication failed')
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Authentication failed')
    }
  }
}
```

## Phase 8: Final Steps

### Step 8.1: Update package.json

Add the auth topic configuration:

```json
{
  "oclif": {
    "topics": {
      "auth": {
        "description": "Authentication commands"
      }
    }
  }
}
```

### Step 8.2: Add Environment Variables Documentation

Create `.env.example`:

```bash
# OAuth Configuration
BR_CLIENT_ID=your-client-id
BR_CLIENT_SECRET=your-client-secret
BR_AUTH_URL=https://auth.byterover.com/oauth/authorize
BR_TOKEN_URL=https://auth.byterover.com/oauth/token
BR_SCOPES=read write

# Encryption (optional, auto-generated if not set)
BR_ENCRYPTION_KEY=your-encryption-key
```

### Step 8.3: Run Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test suites
npm test -- test/unit/**/*.test.ts
npm test -- test/integration/**/*.test.ts
npm test -- test/learning/**/*.test.ts
```

### Step 8.4: Build and Test Manually

```bash
# Build
npm run build

# Test command
./bin/dev.js auth:login --help
./bin/dev.js auth:login
```

## Success Checklist

- [ ] All dependencies installed
- [ ] Auth configuration implemented
- [ ] Domain entities (AuthToken, User) implemented with tests
- [ ] Custom errors defined
- [ ] Interfaces defined (IAuthService, ITokenStore, IBrowserLauncher)
- [ ] Learning tests written and passing
- [ ] OAuthService implemented with PKCE support
- [ ] CallbackServer implemented
- [ ] FileTokenStore implemented with encryption
- [ ] SystemBrowserLauncher implemented
- [ ] LoginUseCase implemented
- [ ] Login command implemented
- [ ] Integration tests passing
- [ ] Manual testing completed
- [ ] Documentation updated
- [ ] 50%+ test coverage achieved

## Next Steps

After completing the login command implementation:

1. Implement `logout` command
2. Add token refresh mechanism
3. Implement user profile fetch
4. Add session management
5. Create authentication middleware for other commands