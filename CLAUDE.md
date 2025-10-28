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

- ✅ **`login` command**: OAuth flow with server lifecycle management, PKCE, multiple async operations with interdependencies - orchestrated directly in command layer
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
  - `Team` - Team entity representing organizational units in ByteRover
    - Fields: `id`, `name`, `displayName`, `description`, `avatarUrl`, `isActive`, `createdAt`, `updatedAt`
    - Constructor uses object parameter pattern (>3 parameters)
    - `fromJson()` handles snake_case API responses, returns camelCase Team instance
    - `toJson()` serializes to camelCase format for JSON output
    - `getDisplayName()` returns the display name for UI presentation
    - Immutable entity with readonly properties and validation
  - `Space` - Space entity representing projects within teams
    - Now includes `teamId` and `teamName` for team association
    - `getDisplayName()` returns `{teamName}/{spaceName}` format
  - `PresignedUrl` - Represents a presigned URL for file upload to blob storage
    - Fields: `fileName`, `uploadUrl`
    - Used for temporary GCS upload URLs with embedded AWS4-HMAC-SHA256 signatures
    - Immutable value object with validation
  - `PresignedUrlsResponse` - Response from presigned URLs request
    - Fields: `presignedUrls` (readonly array), `requestId`
    - Encapsulates both the URLs for upload and the request ID for confirmation
    - Immutable value object with frozen array
    - Validates non-empty arrays and request ID

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
  - `ITeamService` - Team-related operations (fetch user teams)
    - `getTeams(accessToken, sessionKey, option?)` - Fetch teams with pagination
      - Optional parameters: `fetchAll`, `isActive`, `limit`, `offset`
      - Returns: `Promise<{teams: Team[], total: number}>`
      - Supports auto-pagination with `fetchAll: true` option
      - Filter active/inactive teams with `isActive` parameter
  - `ISpaceService` - Space-related operations (fetch spaces within a team)
    - `getSpaces(accessToken, sessionKey, teamId, option?)` - Fetch spaces for a team
      - **Required**: `teamId` parameter to specify which team's spaces to fetch
      - Optional parameters: `fetchAll`, `limit`, `offset`
      - Returns: `Promise<{spaces: Space[], total: number}>`
      - Supports auto-pagination with `fetchAll: true` option
  - `IUserService` - User-related operations (fetch current user information)
  - `IMemoryService` - Memory storage operations (push playbook to blob storage)
    - `confirmUpload(params: ConfirmUploadParams)` - Confirm upload completion to server
      - Parameters: `accessToken`, `sessionKey`, `teamId`, `spaceId`, `requestId`
      - POST to `/memory-processing/confirm-upload` endpoint
      - Must be called after successful file upload before cleanup
      - Returns: `Promise<void>`
    - `getPresignedUrls(params: GetPresignedUrlsParams)` - Request presigned URLs for file upload
      - Parameters: `accessToken`, `sessionKey`, `teamId`, `spaceId`, `branch`, `fileNames`
      - Returns: `Promise<PresignedUrlsResponse>` with presigned URLs and request ID
    - `uploadFile(uploadUrl: string, content: string)` - Upload file to presigned URL
      - Uses plain HTTP PUT with Content-Type: application/json
  - `IPlaybookStore` - Playbook persistence abstraction
    - `clear()` - Clears playbook content by replacing with empty playbook
    - `delete()` - Removes playbook file entirely
    - `exists()` - Checks if playbook exists
    - `load()` - Loads playbook from storage
    - `save()` - Saves playbook to storage

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

- **`team/http-team-service.ts`** - Team service implementation
  - Implements `ITeamService` interface
  - Uses `AuthenticatedHttpClient` internally for API requests
  - Calls `GET {apiBaseUrl}/teams` endpoint to fetch teams
  - Requires both `accessToken` and `sessionKey` parameters
  - Supports pagination with `limit` and `offset` query parameters
  - Supports `is_active` filter to fetch only active/inactive teams
  - Auto-pagination with `fetchAll: true` option (100-item pages)
  - Maps API responses to domain entities (`Team`)
  - Configuration: `{ apiBaseUrl: string }`

- **`space/http-space-service.ts`** - Space service implementation
  - Implements `ISpaceService` interface
  - Uses `AuthenticatedHttpClient` internally for API requests
  - Calls `GET {apiBaseUrl}/spaces?team_id={teamId}` endpoint to fetch spaces
  - **Requires** `teamId` parameter to specify which team's spaces to fetch
  - Requires both `accessToken` and `sessionKey` parameters
  - Supports pagination with `limit` and `offset` query parameters
  - Auto-pagination with `fetchAll: true` option (100-item pages)
  - Maps API responses to domain entities (`Space`)
  - Uses `/* eslint-disable camelcase */` for `team_id` query parameter
  - Configuration: `{ apiBaseUrl: string }`

- **`user/http-user-service.ts`** - User service implementation
  - Implements `IUserService` interface
  - Uses `AuthenticatedHttpClient` internally for API requests
  - Calls `GET {apiBaseUrl}/user/me` endpoint to fetch current user information
  - Requires both `accessToken` and `sessionKey` parameters
  - Maps API responses to domain entities (`User`)
  - Configuration: `{ apiBaseUrl: string, timeout?: number }`

- **`memory/http-memory-service.ts`** - Memory service implementation
  - Implements `IMemoryService` interface
  - Handles playbook upload to ByteRover's blob storage via cogit API
  - **`getPresignedUrls()`** - Requests presigned URLs from cogit API for file uploads
    - Uses `AuthenticatedHttpClient` with both `accessToken` and `sessionKey`
    - POST to `{cogitApiBaseUrl}/organizations/{teamId}/projects/{spaceId}/memory-processing/presigned-urls`
    - Request body: `{ branch: string, file_names: string[] }`
    - Returns array of `PresignedUrl` entities with GCS upload URLs
    - Parameter object pattern: `GetPresignedUrlsParams` with 6 fields
  - **`uploadFile()`** - Uploads file content to GCS using presigned URL
    - Uses plain axios (no auth headers needed for presigned URLs)
    - HTTP PUT with Content-Type: application/json
    - Directly uploads to Google Cloud Storage
  - Configuration: `{ apiBaseUrl: string, timeout?: number }`
  - Error handling: Transforms axios errors to generic Error instances

### Utility Functions (`src/utils/`)

Helper functions for common operations across the codebase.

- **`ace-file-helpers.ts`** - ACE file system utilities
  - `clearDirectory(dirPath: string)` - Removes all files from directory
    - Preserves the directory itself and subdirectories
    - Returns count of files removed for user feedback
    - Handles non-existent directories gracefully (returns 0)
    - Only removes files, not subdirectories
    - Used by `br mem push` for cleanup operations
    - Error handling: Returns 0 for ENOENT, throws for other errors
  - `findMostRecentFile(directory: string)` - Finds latest file by modification time
  - `loadExecutorOutput(filePath: string)` - Loads and parses executor output file
  - `loadReflectorOutput(filePath: string)` - Loads and parses reflector output file
  - `loadDeltaBatch(filePath: string)` - Loads and parses delta batch file
  - `sanitizeHint(hint: string)` - Sanitizes hint strings for filenames

### Configuration (`src/config/`)

Application configuration with runtime environment selection.

- **`environment.ts`** - Runtime environment configuration
  - Defines environment-specific settings (development vs production)
  - Environment is set by launcher scripts (`./bin/dev.js` or `./bin/run.js`)
  - Contains issuerUrl, clientId, scopes, and cogitApiBaseUrl for each environment
  - **cogitApiBaseUrl** - Base URL for cogit API (memory storage service)
    - Development: `https://dev-beta-cogit.byterover.dev/api/v1`
    - Production: `https://prod-beta-cogit.byterover.dev/api/v1`

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
- **@inquirer/prompts** - Interactive CLI prompts for user selections (used in `br init`)
- **Mocha + Chai** - Testing framework
- **Sinon** - Test stubs, spies, and mocks
- **Nock** - HTTP request mocking for tests
- **ESLint** - Linting with oclif config

## Testing Patterns

- **Command testing**: Use subclass pattern to inject mocks via `createServices()`
  - Override `protected createServices()` method in test subclass
  - Override `protected promptForTeamSelection()` and `protected promptForSpaceSelection()` methods for testing interactive prompts
  - Mock selection methods return predetermined Team/Space entities instead of showing real prompts
  - See `test/commands/init.test.ts` for reference implementation with team/space selection
- **Use case testing**: Test business logic in isolation with mocked dependencies
- **HTTP mocking**: Use `nock` for HTTP request mocking
  - For testing `AuthenticatedHttpClient`, use `nock` to intercept axios requests
  - Verify headers with `.matchHeader('authorization', ...)` and `.matchHeader('x-byterover-session-id', ...)`
  - See `test/unit/infra/http/authenticated-http-client.test.ts` for examples
- **Service testing with authenticated requests**:
  - Services using `AuthenticatedHttpClient` (like `HttpTeamService`, `HttpSpaceService`, `HttpUserService`) are tested with `nock`
  - Verify both `Authorization` and `x-byterover-session-id` headers are sent
  - Pass both `accessToken` and `sessionKey` to service methods
  - For `HttpSpaceService`, also verify `team_id` query parameter in nock matcher
  - See `test/unit/infra/team/http-team-service.test.ts`, `test/unit/infra/space/http-space-service.test.ts` and `test/unit/infra/user/http-user-service.test.ts` for reference
- **Stubs/Spies/Mocks**: Use `sinon` for behavior verification
  - When mocking `ITeamService`, `ISpaceService` or `IUserService` in command tests, verify all parameters are passed
  - Example: `expect(teamService.getTeams.calledWith('access-token', 'session-key', {fetchAll: true})).to.be.true`
  - Example: `expect(spaceService.getSpaces.calledWith('access-token', 'session-key', 'team-1', {fetchAll: true})).to.be.true`
  - Example: `expect(userService.getCurrentUser.calledWith('access-token', 'session-key')).to.be.true`
- **Test organization**:
  - `test/commands/` - Command integration tests
  - `test/unit/` - Unit tests mirroring `src/` structure
  - `test/learning/` - Learning/exploration tests
- **ES Module stubbing limitations**:
  - Cannot stub ES module exports directly with `sinon.stub(module, 'function')`
  - For utility functions like `clearDirectory()`, write comprehensive unit tests separately
  - In integration tests, focus on behavior verification through interface calls
  - Example: Test `playbookStore.clear()` was called, rather than stubbing `clearDirectory()`
- **Utility function testing**:
  - Test utility functions in isolation with real file system operations
  - Use temporary directories (`node:os tmpdir()`) for file system tests
  - Clean up test artifacts in `afterEach()` hooks
  - See `test/unit/utils/ace-file-helpers.test.ts` for reference

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

- `Login` command owns the complete flow including server lifecycle
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

### Memory Push Workflow (`br mem push`)

The CLI provides a memory push command that uploads playbooks to ByteRover's blob storage and performs local cleanup:

**Command**: `br mem push [--branch <name>]`

**Workflow Steps**:

1. **Validation**
   - Check authentication (requires valid access token)
   - Verify project initialization (requires `.br/config.json`)
   - Confirm playbook exists (`.br/ace/playbook.json`)

2. **Request Presigned URLs**
   - POST to cogit API: `{cogitApiBaseUrl}/organizations/{teamId}/projects/{spaceId}/memory-processing/presigned-urls`
   - Request body: `{ branch: string, file_names: string[] }`
   - Requires both `Authorization: Bearer {accessToken}` and `x-byterover-session-id: {sessionKey}` headers
   - Response: `PresignedUrlsResponse` with presigned URLs array and request ID

3. **Upload Playbook**
   - Load playbook content using `playbookStore.load()`
   - Serialize playbook to JSON with `playbook.dumps()`
   - Upload to each presigned URL using HTTP PUT
   - Content-Type: application/json

4. **Confirm Upload** (only after successful file upload)
   - POST to cogit API: `{cogitApiBaseUrl}/organizations/{teamId}/projects/{spaceId}/memory-processing/confirm-upload`
   - Request body: `{ request_id: string }` (from step 2 response)
   - Requires both `Authorization: Bearer {accessToken}` and `x-byterover-session-id: {sessionKey}` headers
   - Notifies server that all files have been uploaded successfully
   - Triggers server-side processing of uploaded playbook

5. **Local Cleanup** (only after successful confirmation)
   - **Clear playbook**: `playbookStore.clear()` - Replaces content with empty playbook
   - **Clean executor outputs**: Remove all files from `.br/ace/executor-outputs/`
   - **Clean reflections**: Remove all files from `.br/ace/reflections/`
   - **Clean deltas**: Remove all files from `.br/ace/deltas/`
   - Each cleanup operation shows file count removed

6. **User Feedback**
   - Display progress for each step with spinners
   - Show file counts for each cleanup operation
   - Final success message with branch and file count

**Key Implementation Details**:

- Uses `IMemoryService` for API operations (getPresignedUrls, uploadFile, confirmUpload)
- Uses `IPlaybookStore.clear()` for playbook reset
- Uses `clearDirectory()` utility for file cleanup
- Cleanup only happens after successful upload AND confirmation (fail-fast pattern)
- If upload fails, local files remain unchanged for retry
- If confirmation fails, local files remain unchanged (server not notified)
- Cleanup errors propagate to user (e.g., if `clear()` fails)
- Directory cleanup operations handle missing directories gracefully
- Request ID from presigned URLs response is used for confirmation

**Example Output**:

```text
Requesting upload URLs... done
Loading playbook... done

Uploading files...
  Uploading files... ✓
Confirming upload... ✓

Cleaning up local files...
  Clearing playbook... ✓
  Cleaning executor outputs... ✓ (3 files removed)
  Cleaning reflections... ✓ (2 files removed)
  Cleaning deltas... ✓ (5 files removed)

✓ Successfully pushed playbook to ByteRover memory storage!
  Branch: main
  Files uploaded: 1
```

**Branch Parameter**:

- Default: `main` (ByteRover's internal branching, not Git branches)
- Can be overridden with `--branch` or `-b` flag
- Used for organizing playbook versions in blob storage

### Init Command (`br init`)

The CLI provides an init command that initializes a project with ByteRover using a two-step team and space selection flow:

**Command**: `br init`

**Purpose**:

- Initialize a ByteRover project in the current directory
- Connect project to a specific team and space
- Create local configuration file (`.br/config.json`)
- Initialize ACE playbook structure

**Workflow**:

1. **Check initialization status**: Exit early if project is already initialized
2. **Validate authentication**: Verify user is authenticated with valid token
3. **Fetch all teams**: Auto-fetch all teams using `{fetchAll: true}` option
4. **Team selection**: Interactive prompt using `@inquirer/prompts` select()
   - Display teams with `team.getDisplayName()` format
   - User selects one team from the list
5. **Fetch spaces for selected team**: Auto-fetch all spaces for the selected team using `{fetchAll: true}` option
6. **Space selection**: Interactive prompt using `@inquirer/prompts` select()
   - Display spaces with `space.getDisplayName()` format (`teamName/spaceName`)
   - User selects one space from the list
7. **Save configuration**: Create `BrConfig` from selected space and save to `.br/config.json`
8. **Initialize ACE playbook**: Create empty ACE playbook structure
9. **Display success**: Show confirmation with space and configuration path

**Error Handling**:

- `No teams found`: Prompts user to create a team in ByteRover dashboard
- `No spaces found in team`: Prompts user to create a space for the selected team
- Authentication errors: Prompts user to run `br login` first
- Token expiration: Prompts user to re-authenticate

**User Experience**:

- Uses `@inquirer/prompts` for better interactive selection (arrow keys, search, etc.)
- Displays progress spinners for API calls ("Fetching all teams...", "Fetching all spaces...")
- Shows team/space in `displayName` format for readability
- Clear error messages with actionable guidance

**Implementation Details**:

- Uses `ITeamService.getTeams()` with `{fetchAll: true}` to ensure complete team list
- Uses `ISpaceService.getSpaces(accessToken, sessionKey, teamId, {fetchAll: true})` to fetch spaces for selected team
- `promptForTeamSelection()` method handles team selection with `@inquirer/prompts`
- `promptForSpaceSelection()` method handles space selection with `@inquirer/prompts`
- Always fetches all items (no pagination limits) to show complete lists for selection
- Team selection happens before space selection (two-step flow)

**Example Output**:

```text
Initializing ByteRover project...

Fetching all teams... done

? Select a team (Use arrow keys)
❯ Acme Corp
  Personal Team
  Engineering

Fetching all spaces... done

? Select a space (Use arrow keys)
❯ acme-corp/frontend-app
  acme-corp/backend-api
  acme-corp/mobile-app

Initializing ACE context...
✓ ACE playbook initialized in .br/ace/playbook.json

✓ Project initialized successfully!
✓ Connected to space: acme-corp/frontend-app
✓ Configuration saved to: .br/config.json
```

### Space List Command (`br space list`)

The CLI provides a space list command that displays spaces for the current team (from project config) with pagination support:

**Command**: `br space list [--all] [--limit <n>] [--offset <n>] [--json]`

**Purpose**:

- List spaces for the current team (requires project initialization)
- Support pagination for teams with many spaces
- Provide both human-readable and JSON output formats

**Requirements**:

- Project must be initialized with `br init` (uses team ID from `.br/config.json`)
- User must be authenticated with valid token

**Flags**:

- `--all`, `-a`: Fetch all spaces (may be slow for large teams)
- `--limit <n>`, `-l <n>`: Maximum number of spaces to fetch (default: 50)
- `--offset <n>`, `-o <n>`: Number of spaces to skip (default: 0)
- `--json`, `-j`: Output in JSON format

**Usage Examples**:

```bash
# List first 50 spaces for current team (default)
br space list

# List all spaces for current team
br space list --all

# Custom pagination
br space list --limit 10
br space list --limit 10 --offset 20

# JSON output
br space list --json

# Using short flags
br space list -a
br space list -l 10 -o 20
```

**Output Formats**:

*Human-readable (default)*:

```text
Fetching spaces for Acme Corp... done

Spaces in team "Acme Corp":

Found 127 space(s):

  1. acme-corp/frontend-app
  2. acme-corp/backend-api
  ...
  50. acme-corp/project-50

Showing 50 of 127 spaces.
Use --all to fetch all spaces, or use --limit and --offset for pagination.
```

*JSON format*:

```json
{
  "showing": 50,
  "spaces": [
    {
      "id": "space-1",
      "name": "frontend-app",
      "teamId": "team-1",
      "teamName": "acme-corp"
    }
    ...
  ],
  "team": {
    "id": "team-1",
    "name": "acme-corp"
  },
  "total": 127
}
```

**Behavior**:

1. **Project Initialization Check**: Verifies `.br/config.json` exists, errors with "Project not initialized. Run 'br init' first." if not found
2. **Team ID from Config**: Automatically reads `teamId` from project config (no manual input required)
3. **Authentication**: Requires valid authentication token (checks via `validateAuth()`)
4. **Default Pagination**: Fetches first 50 spaces by default
5. **Pagination Warning**: Displays message when more spaces exist
6. **fetchAll Mode**: With `--all` flag, automatically paginates to fetch all spaces
7. **Empty State**: Shows "No spaces found in team \"{teamName}\"." if team has no spaces
8. **Team Context**: Displays team name in all messages for clarity

**Implementation Details**:

- Uses `IProjectConfigStore.read()` to load project configuration
- Extracts `teamId` and `teamName` from `BrConfig` entity
- Uses `ISpaceService.getSpaces(accessToken, sessionKey, teamId, options)` with team ID from config
- Passes `{fetchAll: true}` when `--all` flag is used
- Passes `{limit, offset}` for manual pagination control
- Displays spaces using `space.getDisplayName()` format (`teamName/spaceName`)
- Shows team context in spinner: "Fetching spaces for {teamName}..."
- Includes team info in JSON output for clarity
- Follows same initialization pattern as `br mem push` command

**Context-Aware Pagination**:

Different commands use different pagination strategies:

- `br space list`: Default 50 items, optional `--all` for browsing (requires init)
- `br init`: Always uses `{fetchAll: true}` to ensure complete space list for selection

### ISpaceService Interface with Pagination

The `ISpaceService` interface has been enhanced to support team-scoped queries and pagination:

**Updated Interface**:

```typescript
interface ISpaceService {
  getSpaces(
    accessToken: string,
    sessionKey: string,
    teamId: string,  // REQUIRED: Team ID to fetch spaces for
    option?: {
      fetchAll?: boolean  // Auto-paginate to fetch all spaces
      limit?: number      // Maximum spaces per request
      offset?: number     // Number of spaces to skip
    }
  ): Promise<{
    spaces: Space[]
    total: number  // Total count across all pages
  }>
}
```

**Pagination Options**:

1. **No options** (default): Single API call, backend default page size
2. **`{limit, offset}`**: Manual pagination control for single page
3. **`{fetchAll: true}`**: Auto-pagination internally until all fetched

**Implementation** (`HttpSpaceService`):

- **Manual Pagination**: Builds query string with URLSearchParams
  - Example: `GET /spaces?limit=50&offset=100`
- **Auto-Pagination**: Internal loop with 100-item pages for efficiency
  - Automatically stops when `allSpaces.length >= total`
  - Prevents over-fetching with empty page detection
- **Return Type**: Always returns `{spaces: Space[], total: number}`
- **API Response**: Expects `{data: {spaces: [], total: number}}`

**Breaking Changes**:

1. **Required `teamId` parameter**: `getSpaces()` now requires a `teamId` parameter to specify which team's spaces to fetch
2. **Return type changed**: Return type changed from `Space[]` to `{spaces: Space[], total: number}`

Existing code must be updated:

```typescript
// Before
const spaces = await spaceService.getSpaces(accessToken, sessionKey)

// After
const result = await spaceService.getSpaces(
  accessToken,
  sessionKey,
  teamId,  // NEW REQUIRED PARAMETER
  {fetchAll: true}
)
const spaces = result.spaces
const total = result.total
```

**Updated Commands**:

- `init.ts`: First fetches all teams, user selects team, then fetches spaces for selected team with `{fetchAll: true}`
- `space/list.ts`: Requires `--team-id` flag, uses pagination options based on flags

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
