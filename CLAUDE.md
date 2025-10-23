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

The codebase follows Clean Architecture with three main layers:

### Core Layer (`src/core/`)

Domain logic independent of frameworks and external dependencies.

- **`domain/entities/`** - Business entities with validation and behavior
  - `AuthToken` - Represents OAuth tokens with expiration logic
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

### Infrastructure Layer (`src/infra/`)

Concrete implementations of core interfaces using external dependencies.

- **`auth/oauth-service.ts`** - OAuth 2.0 + PKCE implementation using axios
  - Manages PKCE lifecycle internally (code_verifier generation and storage)
  - Provides AuthorizationContext abstraction to hide implementation details
  - Handles authorization URL generation with code challenges
  - Token exchange and refresh operations
  - Error mapping from HTTP to domain errors

- **`http/callback-handler.ts`** - OAuth callback handler implementation
  - Implements `ICallbackHandler` interface
  - Adapter wrapping `CallbackServer` for OAuth redirect handling
  - Manages local HTTP server lifecycle for receiving authorization codes

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

## Key Technologies

- **oclif v4** - CLI framework with plugin system
- **TypeScript** - Strict mode, ES2022 target, Node16 modules
- **axios** - HTTP client for OAuth operations
- **express** - Local callback server for OAuth flows
- **Mocha + Chai** - Testing framework
- **ESLint** - Linting with oclif config

## Testing Patterns

- Use `@oclif/test` for command testing
- Use `nock` for HTTP request mocking
- Use `sinon` for stubs/spies/mocks
- Test files mirror source structure in `test/unit/`
- Integration tests in `test/commands/`

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
8. **Store tokens securely** - Save to system keychain via `KeychainTokenStore`
9. **Cleanup** - Stop callback server (happens even on errors)

**Key Implementation Details:**

- `LoginUseCase` owns the complete flow including server lifecycle
- `OAuthService` encapsulates PKCE implementation details (code_verifier generation, storage, and retrieval)
- `AuthorizationContext` provides abstraction: contains authUrl and state, hides code_verifier
- `redirectUri` is built dynamically after callback server starts: `http://localhost:{port}/callback`
- Same `redirectUri` passed to both `initiateAuthorization()` and `exchangeCodeForToken()` (OAuth 2.0 compliance)
- `redirectUri` is optional in `OAuthConfig` since it's determined at runtime for CLI flows
- Cryptographically secure state parameter generated by OAuthService using `crypto.randomBytes()` for CSRF protection
- Code_verifier is single-use: automatically deleted after token exchange
- If browser fails to open, auth URL is returned to user for manual copy
- Callback server always cleaned up via `finally` block
- `CallbackServer` tracks active HTTP connections and force-closes them during shutdown to prevent delays from keep-alive connections

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
