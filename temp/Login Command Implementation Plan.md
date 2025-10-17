# Login Command Implementation Plan

## Overview

Implement a `login` command that authenticates users via OAuth2/OIDC Authorization Code flow,
following clean architecture principles and best practices.

## Architecture Design

### Folder Structure

```txt
src/
  commands/
    auth/
      login.ts          # Login command entry point
  core/
    domain/
      entities/
        AuthToken.ts    # Domain entity for auth tokens
        User.ts         # Domain entity for user
      errors/
        AuthError.ts    # Custom auth errors
    usecases/
      LoginUseCase.ts   # Business logic for login
    interfaces/
      IAuthService.ts   # Auth service contract
      ITokenStore.ts    # Token storage contract
      IBrowserLauncher.ts # Browser launcher contract
  infrastructure/
    auth/
      OAuthService.ts   # OAuth implementation
    storage/
      FileTokenStore.ts # File-based token storage
    browser/
      SystemBrowserLauncher.ts # System browser launcher
    http/
      CallbackServer.ts # Local HTTP server for callback
  config/
    auth.config.ts      # Auth configuration

test/
  unit/
    core/
      usecases/
        LoginUseCase.test.ts
      domain/
        entities/
          AuthToken.test.ts
  integration/
    commands/
      auth/
        login.test.ts
  learning/
    oauth/
      authorization-code-flow.test.ts
    http/
      local-server.test.ts
```

## Implementation Steps

### Phase 1: Setup & Configuration (TDD)

#### 1.1 Auth Configuration

- Create `src/config/auth.config.ts`
- Define OAuth2 configuration interface
- Set up environment variables for:
  - Client ID
  - Client Secret (if applicable for CLI)
  - Authorization URL
  - Token URL
  - Redirect URI (localhost with random port)
  - Scopes

#### 1.2 Domain Entities (TDD)

- **AuthToken Entity** (`src/core/domain/entities/AuthToken.ts`)
  - Properties: accessToken, refreshToken, expiresAt, tokenType
  - Methods: isExpired(), isValid()
  - Write unit tests first
  
- **User Entity** (`src/core/domain/entities/User.ts`)
  - Properties: id, email, name
  - Write unit tests first

- **Custom Errors** (`src/core/domain/errors/AuthError.ts`)
  - AuthenticationError
  - TokenExpiredError
  - InvalidTokenError

### Phase 2: Core Interfaces (TDD)

#### 2.1 Define Contracts

- **IAuthService** (`src/core/interfaces/IAuthService.ts`)

  ```typescript
  interface IAuthService {
    getAuthorizationUrl(state: string, codeVerifier: string): string
    exchangeCodeForToken(code: string, codeVerifier: string): Promise<AuthToken>
    refreshToken(refreshToken: string): Promise<AuthToken>
  }
  ```

- **ITokenStore** (`src/core/interfaces/ITokenStore.ts`)

  ```typescript
  interface ITokenStore {
    save(token: AuthToken): Promise<void>
    load(): Promise<AuthToken | null>
    clear(): Promise<void>
  }
  ```

- **IBrowserLauncher** (`src/core/interfaces/IBrowserLauncher.ts`)

  ```typescript
  interface IBrowserLauncher {
    open(url: string): Promise<void>
  }
  ```

### Phase 3: Use Cases (TDD)

#### 3.1 LoginUseCase

- **File**: `src/core/usecases/LoginUseCase.ts`
- **Test First**: Write `test/unit/core/usecases/LoginUseCase.test.ts`
- **Dependencies**: IAuthService, ITokenStore, IBrowserLauncher
- **Flow**:
  1. Generate PKCE code verifier and challenge
  2. Generate state parameter
  3. Build authorization URL
  4. Launch browser with authorization URL
  5. Start local callback server
  6. Wait for authorization code
  7. Exchange code for token
  8. Store token securely
  9. Return success/failure

- **Test Cases**:
  - Successful login flow
  - User cancels authorization
  - Invalid authorization code
  - Network errors
  - Token storage failures

### Phase 4: Infrastructure (TDD + Learning Tests)

#### 4.1 Learning Tests

- **OAuth Flow** (`test/learning/oauth/authorization-code-flow.test.ts`)
  - Test PKCE code generation
  - Test state parameter generation
  - Test authorization URL construction
  - Mock token exchange

- **Local HTTP Server** (`test/learning/http/local-server.test.ts`)
  - Test server creation on random port
  - Test callback handling
  - Test timeout scenarios

#### 4.2 OAuthService Implementation

- **File**: `src/infrastructure/auth/OAuthService.ts`
- **Write tests first**: `test/unit/infrastructure/auth/OAuthService.test.ts`
- **Dependencies**: node-fetch or axios, crypto (for PKCE)
- **Implementation**:
  - PKCE code verifier/challenge generation
  - Authorization URL building with parameters
  - Token exchange with code
  - Token refresh logic
  - Error handling and retry logic

#### 4.3 CallbackServer

- **File**: `src/infrastructure/http/CallbackServer.ts`
- **Write tests first**: `test/unit/infrastructure/http/CallbackServer.test.ts`
- **Implementation**:
  - Create HTTP server on random available port
  - Handle GET /callback route
  - Extract authorization code and state
  - Validate state parameter
  - Display success/error page to user
  - Auto-close after timeout or success
  - Proper cleanup on shutdown

#### 4.4 FileTokenStore

- **File**: `src/infrastructure/storage/FileTokenStore.ts`
- **Write tests first**: `test/unit/infrastructure/storage/FileTokenStore.test.ts`
- **Implementation**:
  - Store tokens in `~/.byterover/credentials.json`
  - Encrypt tokens at rest (use node's crypto)
  - Atomic file writes
  - Proper file permissions (0600)
  - Handle file not found gracefully

#### 4.5 SystemBrowserLauncher

- **File**: `src/infrastructure/browser/SystemBrowserLauncher.ts`
- **Write tests first**: `test/unit/infrastructure/browser/SystemBrowserLauncher.test.ts`
- **Implementation**:
  - Use `open` package to launch default browser
  - Cross-platform support (Windows, macOS, Linux)
  - Handle browser launch failures gracefully

### Phase 5: Command Implementation (TDD)

#### 5.1 Login Command

- **File**: `src/commands/auth/login.ts`
- **Write integration tests first**: `test/integration/commands/auth/login.test.ts`
- **Implementation**:

  ```typescript
  import {Command, Flags} from '@oclif/core'
  import {LoginUseCase} from '../../core/usecases/LoginUseCase.js'
  
  export default class Login extends Command {
    static description = 'Authenticate with ByteRover'
    static examples = ['<%= config.bin %> <%= command.id %>']
    static flags = {
      browser: Flags.boolean({
        char: 'b',
        description: 'Open browser automatically',
        default: true
      })
    }
    
    async run(): Promise<void> {
      // Dependency injection
      // Execute LoginUseCase
      // Handle success/error
      // Display appropriate messages
    }
  }
  ```

- **User Experience**:
  - Show spinner while waiting for authentication
  - Display authorization URL if browser fails
  - Show timeout countdown
  - Clear success/error messages
  - Handle interruption (Ctrl+C) gracefully

### Phase 6: Integration Tests

#### 6.1 End-to-End Login Test

- **File**: `test/integration/commands/auth/login.test.ts`
- **Test Scenarios**:
  - Mock OAuth server responses
  - Test full flow with mocked dependencies
  - Test token persistence
  - Test error scenarios
  - Test timeout handling

#### 6.2 Token Storage Integration

- Test reading/writing to actual filesystem
- Test encryption/decryption
- Test file permissions

## Dependencies to Add

```json
{
  "dependencies": {
    "open": "^9.0.0",           // Browser launcher
    "axios": "^1.0.0",          // HTTP client
    "express": "^4.18.0",       // Local callback server
    "nanoid": "^4.0.0"          // Generate state/PKCE
  },
  "devDependencies": {
    "nock": "^13.0.0",          // HTTP mocking for tests
    "sinon": "^15.0.0",         // Stubbing/spying
    "tmp": "^0.2.0"             // Temporary directories for tests
  }
}
```

## Testing Strategy

### Test Coverage Goals

- **Unit Tests**: 50% minimum coverage
  - Focus on: Domain entities, Use cases, Infrastructure services
  - Critical paths: Token validation, PKCE generation, OAuth flow
  
- **Integration Tests**: Cover main flows
  - Full login flow (mocked OAuth provider)
  - Token storage and retrieval
  - Error handling scenarios

- **Learning Tests**: Document external API usage
  - OAuth2 spec compliance
  - HTTP server behavior
  - File system operations
  - Browser launching

## Clean Code Principles

### 1. Separation of Concerns

- Commands orchestrate, don't contain business logic
- Use cases contain business logic
- Infrastructure handles external dependencies

### 2. Dependency Inversion

- Depend on interfaces, not implementations
- Use dependency injection in commands

### 3. Single Responsibility

- Each class/function has one reason to change
- Small, focused functions

### 4. Error Handling

- Use custom error types
- Proper error propagation
- User-friendly error messages

### 5. Configuration Management

- Environment variables for sensitive data
- Configuration validation on startup
- Default values for optional settings

## CLI Best Practices

### 1. User Experience

- Clear progress indicators (spinners)
- Helpful error messages with solutions
- Graceful degradation (manual URL if browser fails)
- Timeout with countdown display

### 2. Security

- Never log sensitive tokens
- Secure token storage with encryption
- Clear tokens on logout
- PKCE for public clients

### 3. Reliability

- Timeout mechanisms
- Retry logic for network operations
- Graceful error recovery
- Proper cleanup on exit

### 4. Documentation

- Clear command description
- Usage examples
- Flag documentation

## Implementation Order

1. ✅ Setup folder structure
2. ✅ Write learning tests for OAuth and HTTP
3. ✅ Implement domain entities (TDD)
4. ✅ Define interfaces
5. ✅ Implement LoginUseCase (TDD)
6. ✅ Implement OAuthService (TDD)
7. ✅ Implement CallbackServer (TDD)
8. ✅ Implement FileTokenStore (TDD)
9. ✅ Implement SystemBrowserLauncher (TDD)
10. ✅ Implement Login command (TDD)
11. ✅ Write integration tests
12. ✅ Manual testing
13. ✅ Documentation

## Success Criteria

- [ ] All unit tests passing (50%+ coverage)
- [ ] All integration tests passing
- [ ] Learning tests documented
- [ ] Clean architecture maintained
- [ ] OAuth2/OIDC compliant
- [ ] Secure token storage
- [ ] Cross-platform support
- [ ] Clear user experience
- [ ] Proper error handling
- [ ] Documentation complete

## Future Enhancements (Out of Scope)

- Logout command
- Token refresh on API calls
- Multiple authentication providers
- SSO support
- MFA support
- Session management
