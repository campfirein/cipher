# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ByteRover CLI (`br`) is a command-line interface tool built with [oclif](https://oclif.io). The project uses TypeScript with ES modules and follows Clean Architecture principles with a clear separation between domain, infrastructure, and application layers.

## Development Commands

### Build

```bash
# Standard build (uses default development environment)
npm run build

# Build for development environment
npm run build:dev

# Build for production environment
npm run build:prod
```

Compiles TypeScript to JavaScript in the `dist/` directory. The build environment determines which OIDC configuration is bundled into the CLI.

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
  - `IAuthService` - OAuth authentication operations
  - `ITokenStore` - Token persistence abstraction
  - `IBrowserLauncher` - Browser launching abstraction
  - `IOidcDiscoveryService` - OIDC discovery operations

### Infrastructure Layer (`src/infra/`)

Concrete implementations of core interfaces using external dependencies.

- **`auth/oauth-service.ts`** - OAuth 2.0 + PKCE implementation using axios
  - Handles authorization URL generation with code challenges
  - Token exchange and refresh operations
  - Error mapping from HTTP to domain errors

### Configuration (`src/config/`)

Application configuration combining build-time and runtime settings.

- **`environment.ts`** - Build-time environment configuration
  - Defines environment-specific settings (development vs production)
  - Bundled at build time via `BR_BUILD_ENV` environment variable
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
2. **Generate authorization URL** with PKCE code challenge
3. **Launch browser** to authorization endpoint
4. **Run local Express server** to receive callback
5. **Exchange authorization code** for tokens
6. **Store tokens securely** in system keychain via `KeychainTokenStore`

### OIDC Discovery

- **Discovery Service**: `OidcDiscoveryService` implements `IOidcDiscoveryService`
- **Endpoint**: `{issuerUrl}/.well-known/openid-configuration`
- **Caching**: 1-hour TTL to reduce network calls
- **Retry Logic**: 3 attempts with exponential backoff (1s, 2s, 4s)
- **Timeout**: 5 seconds per request
- **Fallback**: Hardcoded environment-specific URLs if discovery fails

### Build-Time Configuration

The CLI uses build-time environment configuration for separate dev/prod deployments:

```typescript
// Development build (npm run build:dev)
{
  issuerUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc',
  clientId: 'byterover-cli-client',
  scopes: ['read', 'write', 'debug']
}

// Production build (npm run build:prod)
{
  issuerUrl: 'https://prod-beta-iam.byterover.dev/api/v1/oidc',
  clientId: 'byterover-cli-prod',
  scopes: ['read', 'write']
}
```

**Distribution**:

- `npm run pack:dev` - Creates development tarball
- `npm run pack:prod` - Creates production tarball

## Environment Variables

### Build-Time (set during build)

- `BR_BUILD_ENV` - Environment (`development` | `production`)

### Runtime (optional)

- `BR_CLIENT_SECRET` - OAuth client secret (not needed for public clients with PKCE)
- `BR_CLIENT_ID` - Override build-time clientId (for testing)
- `BR_SCOPES` - Override build-time scopes (space-separated)
- `BR_AUTH_URL` - **Emergency override** for authorization endpoint
- `BR_TOKEN_URL` - **Emergency override** for token endpoint

### Other

- `BR_NPM_LOG_LEVEL` - npm log level for plugin installations
- `BR_NPM_REGISTRY` - npm registry for plugin installations

**Note**: `BR_AUTH_URL` and `BR_TOKEN_URL` override discovery for disaster recovery scenarios only.

## Code Style Notes

- Use explicit access modifiers (`public`, `private`, `readonly`)
- Prefer `const` for all variables
- Use arrow functions for class methods that don't need `this` rebinding
- Interface names prefixed with `I` (e.g., `IAuthService`)
- Enable `/* eslint-disable camelcase */` when interfacing with snake_case APIs
- All entities have `toJSON()`/`fromJSON()` for serialization

## Plugin System

The CLI supports oclif plugins via `@oclif/plugin-plugins`. Users can install, link, and manage plugins through the `br plugins` command namespace.
