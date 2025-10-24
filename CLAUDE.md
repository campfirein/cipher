# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ByteRover CLI (`br`) is a command-line interface tool built with [oclif](https://oclif.io). The project uses TypeScript with ES modules and follows Clean Architecture principles with a clear separation between domain, infrastructure, and application layers.

## Development Commands

### Build

```bash
# Standard build
npm run build
```

Compiles TypeScript to JavaScript in the `dist/` directory.

### Test

```bash
# Run all tests
npm test

# Run a single test file
npx mocha --forbid-only "test/path/to/file.test.ts"
```

Uses Mocha + Chai for testing. Tests are organized in `test/` with subdirectories:

- `test/commands/` - Command integration tests
- `test/unit/` - Unit tests mirroring `src/` structure
- `test/learning/` - Learning/exploration tests

### Lint

```bash
npm run lint
```

Runs ESLint with oclif and prettier configurations.

### Run CLI Locally

```bash
# Development mode (uses ts-node)
./bin/dev.js [command]

# Production mode (uses compiled dist/)
./bin/run.js [command]
```

### Add New Command

```bash
npx oclif generate command
```

## Architecture

The codebase follows Clean Architecture principles with pragmatic adaptations for CLI development:

### When to Use Use Cases

Use cases are employed for **complex orchestration** that benefits from framework independence:

- ✅ **`LoginUseCase`**: OAuth flow with server lifecycle management, PKCE, multiple async operations with interdependencies
- ❌ **`init` command**: Simple linear flow with UI interaction - orchestrated directly in command layer

Commands may orchestrate business logic directly when:

- The flow is primarily UI-driven with user interactions
- No complex state management across async operations
- The logic is specific to CLI context and unlikely to be reused in other interfaces

### Architecture Layers

The codebase follows Clean Architecture with three main layers:

### Core Layer (`src/core/`)

Domain logic independent of frameworks and external dependencies.

- **`domain/entities/`** - Business entities with validation and behavior
  - `AuthToken` - Represents OAuth tokens with expiration logic and session tracking
    - Fields: `accessToken`, `expiresAt`, `refreshToken`, `sessionKey`, `tokenType`
    - `sessionKey` is used for the `x-byterover-session-id` header in API requests
    - Includes `toJson()`/`fromJson()` for serialization to/from keychain storage
  - `User` - User entity with serialization methods

- **`domain/errors/`** - Domain-specific error types
  - `AuthenticationError`, `TokenExpiredError`, `InvalidTokenError`
  - `DiscoveryError`, `DiscoveryTimeoutError`, `DiscoveryNetworkError`

- **`interfaces/`** - Port definitions (dependency inversion)
  - `IAuthService` - OAuth authentication operations with AuthorizationContext encapsulation
  - `ITokenStore` - Token persistence abstraction
  - `IBrowserLauncher` - Browser launching abstraction
  - `ICallbackHandler` - OAuth callback server operations
  - `IOidcDiscoveryService` - OIDC discovery operations
  - `IHttpClient` - HTTP client abstraction for authenticated API requests
  - `ISpaceService` - Space-related operations (fetch user spaces)
  - `IUserService` - User-related operations (fetch current user information)

### Infrastructure Layer (`src/infra/`)

Concrete implementations of core interfaces using external dependencies.

- **`auth/oauth-service.ts`** - OAuth 2.0 + PKCE implementation using axios
  - Manages PKCE lifecycle internally (code_verifier generation and storage)
  - Provides AuthorizationContext abstraction to hide implementation details
  - Handles authorization URL generation with code challenges
  - Token exchange and refresh operations
  - Parses token response including `session_key` for session tracking
  - Error mapping from HTTP to domain errors

- **`http/callback-handler.ts`** - OAuth callback handler implementation
  - Implements `ICallbackHandler` interface
  - Adapter wrapping `CallbackServer` for OAuth redirect handling
  - Manages local HTTP server lifecycle for receiving authorization codes

- **`http/authenticated-http-client.ts`** - HTTP client for authenticated API requests
  - Implements `IHttpClient` interface
  - Automatically adds `Authorization: Bearer {token}` header
  - Automatically adds `x-byterover-session-id: {sessionKey}` header
  - Wraps axios for GET and POST operations
  - Transforms axios errors to generic Error instances
  - Used by API services (e.g., `HttpSpaceService`) for making authenticated requests

- **`space/http-space-service.ts`** - Space service implementation
  - Implements `ISpaceService` interface
  - Uses `AuthenticatedHttpClient` internally for API requests
  - Requires both `accessToken` and `sessionKey` parameters
  - Maps API responses to domain entities (`Space`)

- **`user/http-user-service.ts`** - User service implementation
  - Implements `IUserService` interface
  - Uses `AuthenticatedHttpClient` internally for API requests
  - Calls `GET {apiBaseUrl}/user/me` endpoint to fetch current user information
  - Requires both `accessToken` and `sessionKey` parameters
  - Maps API responses to domain entities (`User`)
  - Configuration: `{ apiBaseUrl: string, timeout?: number }`

### Configuration (`src/config/`)

Application configuration with runtime environment selection.

- **`environment.ts`** - Runtime environment configuration
  - Defines environment-specific settings (development vs production)
  - Environment is set by launcher scripts (`./bin/dev.js` or `./bin/run.js`)
  - Contains issuerUrl, clientId, and scopes for each environment

- **`auth.config.ts`** - OAuth configuration with OIDC discovery
  - Uses `IOidcDiscoveryService` to dynamically fetch endpoints
  - Falls back to hardcoded URLs if discovery fails
  - Supports environment variable overrides for disaster recovery

### Commands (`src/commands/`)

oclif command definitions. Commands are auto-discovered based on file structure.

- Use nested directories for command namespaces (e.g., `commands/hello/world.ts` → `br hello world`)
- Each command extends `Command` from `@oclif/core`

#### Dependency Injection Pattern for Testability

Commands use a **protected factory method pattern** to enable dependency injection without complicating production code:

```typescript
export default class MyCommand extends Command {
  protected createServices(): {
    myService: IMyService
    anotherService: IAnotherService
  } {
    return {
      myService: new MyServiceImpl(),
      anotherService: new AnotherServiceImpl(),
    }
  }

  public async run(): Promise<void> {
    const {myService, anotherService} = this.createServices()
    // Use services...
  }
}
```

**Testing Pattern:**

```typescript
class TestableMyCommand extends MyCommand {
  constructor(
    private mockService: IMyService,
    private mockAnother: IAnotherService,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    return {
      myService: this.mockService,
      anotherService: this.mockAnother,
    }
  }
}
```

**Benefits:**

- Production code uses real implementations automatically
- Tests override factory to inject mocks
- Commands depend on interfaces (Dependency Inversion Principle)
- No constructor complexity (works with oclif's DI)
- Type-safe: explicit return types prevent `as` assertions

## Key Technologies

- **oclif v4** - CLI framework with plugin system
- **TypeScript** - Strict mode, ES2022 target, Node16 modules
- **axios** - HTTP client for OAuth operations
- **express** - Local callback server for OAuth flows
- **node:readline** - User input prompts for CLI interactions
- **Mocha + Chai** - Testing framework
- **ESLint** - Linting with oclif config

## Testing Patterns

- **Command testing**: Use subclass pattern to inject mocks via `createServices()`
  - Override `protected createServices()` method in test subclass
  - Override `protected promptUser()` or similar methods for input testing
  - See `test/commands/init.test.ts` for reference implementation
- **Use case testing**: Test business logic in isolation with mocked dependencies
- **HTTP mocking**: Use `nock` for HTTP request mocking
  - For testing `AuthenticatedHttpClient`, use `nock` to intercept axios requests
  - Verify headers with `.matchHeader('authorization', ...)` and `.matchHeader('x-byterover-session-id', ...)`
  - See `test/unit/infra/http/authenticated-http-client.test.ts` for examples
- **Service testing with authenticated requests**:
  - Services using `AuthenticatedHttpClient` (like `HttpSpaceService`, `HttpUserService`) are tested with `nock`
  - Verify both `Authorization` and `x-byterover-session-id` headers are sent
  - Pass both `accessToken` and `sessionKey` to service methods
  - See `test/unit/infra/space/http-space-service.test.ts` and `test/unit/infra/user/http-user-service.test.ts` for reference
- **Stubs/Spies/Mocks**: Use `sinon` for behavior verification
  - When mocking `ISpaceService` or `IUserService` in command tests, verify both parameters are passed
  - Example: `expect(spaceService.getSpaces.calledWith('access-token', 'session-key')).to.be.true`
  - Example: `expect(userService.getCurrentUser.calledWith('access-token', 'session-key')).to.be.true`
- **Test organization**:
  - `test/commands/` - Command integration tests
  - `test/unit/` - Unit tests mirroring `src/` structure
  - `test/learning/` - Learning/exploration tests

## TypeScript Configuration

- ES modules (`"type": "module"` in package.json)
- All imports require `.js` extension (TypeScript + Node16 module resolution)
- Strict mode enabled
- Output to `dist/`, source in `src/`

## OAuth Flow Architecture

The CLI implements OAuth 2.0 Authorization Code flow with PKCE:

1. **OIDC Discovery** - Fetch endpoints from `{issuerUrl}/.well-known/openid-configuration`
2. **Start callback server** - Local HTTP server listens on random port for OAuth redirect
3. **Build redirect URI** - Construct `http://localhost:{port}/callback` using actual server port
4. **Initiate authorization** - OAuthService generates PKCE parameters (code_verifier, state) and authorization URL internally, returns AuthorizationContext
5. **Launch browser** - Open authorization endpoint in user's default browser
6. **Wait for callback** - Server receives authorization code at `/callback` endpoint, validates state
7. **Exchange authorization code** for tokens - OAuthService retrieves code_verifier from AuthorizationContext and exchanges with auth server
8. **Parse token response** - Extract `access_token`, `refresh_token`, `session_key`, `expires_in`, and `token_type` from OAuth server response
9. **Store tokens securely** - Save AuthToken (including sessionKey) to system keychain via `KeychainTokenStore`
10. **Cleanup** - Stop callback server (happens even on errors)

**Key Implementation Details:**

- `LoginUseCase` owns the complete flow including server lifecycle
- `OAuthService` encapsulates PKCE implementation details (code_verifier generation, storage, and retrieval)
- `AuthorizationContext` provides abstraction: contains authUrl and state, hides code_verifier
- `redirectUri` is built dynamically after callback server starts: `http://localhost:{port}/callback`
- Same `redirectUri` passed to both `initiateAuthorization()` and `exchangeCodeForToken()` (OAuth 2.0 compliance)
- `redirectUri` is optional in `OAuthConfig` since it's determined at runtime for CLI flows
- Cryptographically secure state parameter generated by OAuthService using `crypto.randomBytes()` for CSRF protection
- Code_verifier is single-use: automatically deleted after token exchange
- Token response includes `session_key` which is stored in `AuthToken.sessionKey` for use in API requests (via `x-byterover-session-id` header)
- If browser fails to open, auth URL is returned to user for manual copy
- Callback server always cleaned up via `finally` block
- `CallbackServer` tracks active HTTP connections and force-closes them during shutdown to prevent delays from keep-alive connections

### Authenticated API Requests

After successful authentication, all API requests to ByteRover services require both authentication headers:

1. **Commands load tokens from keychain** - Use `ITokenStore.load()` to retrieve the stored `AuthToken`
2. **Extract both credentials** - Commands pass `token.accessToken` and `token.sessionKey` to service methods
3. **Services create HTTP client** - API services (e.g., `HttpSpaceService`) instantiate `AuthenticatedHttpClient` with both credentials
4. **Automatic header injection** - `AuthenticatedHttpClient` adds both headers to all requests:
   - `Authorization: Bearer {accessToken}` - Standard OAuth 2.0 bearer token
   - `x-byterover-session-id: {sessionKey}` - Session tracking identifier from token response

**Example flow:**

```typescript
// Command loads token
const token = await tokenStore.load()

// Command calls service with both credentials
const spaces = await spaceService.getSpaces(token.accessToken, token.sessionKey)

// Service creates authenticated HTTP client
const httpClient = new AuthenticatedHttpClient(accessToken, sessionKey)

// Client automatically adds both headers to requests
const response = await httpClient.get('/api/endpoint')
```

**Benefits:**

- Centralized authentication header management
- No risk of forgetting session header in new API calls
- Clean separation: services focus on business logic, HTTP client handles authentication
- Easy to test with `nock` header matching

### OIDC Discovery

- **Discovery Service**: `OidcDiscoveryService` implements `IOidcDiscoveryService`
- **Endpoint**: `{issuerUrl}/.well-known/openid-configuration`
- **Caching**: 1-hour TTL to reduce network calls
- **Retry Logic**: 3 attempts with exponential backoff (1s, 2s, 4s)
- **Timeout**: 5 seconds per request
- **Fallback**: Hardcoded environment-specific URLs if discovery fails

### Environment Configuration

The CLI uses runtime environment configuration for separate dev/prod deployments:

```typescript
// Development environment (./bin/dev.js)
{
  issuerUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc',
  clientId: 'byterover-cli-client',
  scopes: ['read', 'write', 'debug']
}

// Production environment (./bin/run.js)
{
  issuerUrl: 'https://prod-beta-iam.byterover.dev/api/v1/oidc',
  clientId: 'byterover-cli-prod',
  scopes: ['read', 'write']
}
```

**How it works**:

- `./bin/dev.js` sets `BR_ENV=development` before loading the CLI
- `./bin/run.js` sets `BR_ENV=production` before loading the CLI
- The environment is selected at runtime based on which launcher script is used

**Distribution**:

- `npm run pack:dev` - Creates development tarball
- `npm run pack:prod` - Creates production tarball

## Environment Variables

### Runtime (set by launcher scripts)

- `BR_ENV` - Environment (`development` | `production`) - automatically set by `./bin/dev.js` or `./bin/run.js`

### Plugin Configuration

- `BR_NPM_LOG_LEVEL` - npm log level for plugin installations
- `BR_NPM_REGISTRY` - npm registry for plugin installations

## Code Style Notes

- Use explicit access modifiers (`public`, `private`, `readonly`)
- Prefer `const` for all variables
- Use arrow functions for class methods that don't need `this` rebinding
- Interface names prefixed with `I` (e.g., `IAuthService`)
- Enable `/* eslint-disable camelcase */` when interfacing with snake_case APIs
- All entities have `toJSON()`/`fromJSON()` for serialization

## Plugin System

The CLI supports oclif plugins via `@oclif/plugin-plugins`. Users can install, link, and manage plugins through the `br plugins` command namespace.
