# Use Case Extraction Pattern

Guide for extracting use cases from oclif commands following Clean Architecture.

## 1. Create Interface

Location: `src/core/interfaces/usecase/i-<name>-use-case.ts`

```typescript
export interface I<Name>UseCase {
  run(): Promise<void>
}
```

## 2. Create Implementation

Location: `src/infra/usecase/<name>-use-case.ts`

- Move business logic from command to use case class
- Constructor receives dependencies (services, terminal, etc.)
- Make prompt methods `protected` for test overrides
- Use `terminal.log()` + `return` for validation errors (user-friendly, no stack traces)

```typescript
export class MyUseCase implements IMyUseCase {
  constructor(
    private readonly fileService: IFileService,
    private readonly terminal: ITerminal,
    // ... other dependencies
  ) {}

  protected async promptForSelection(): Promise<string> {
    return this.terminal.select({ ... })
  }

  public async run(): Promise<void> {
    // Validation - use terminal.log() and return early (user-friendly, no stack traces)
    const config = await this.configStore.read()
    if (!config) {
      this.terminal.log('Not initialized. Please run "brv init" first.')
      return
    }

    const token = await this.tokenStore.load()
    if (!token) {
      this.terminal.log('Not authenticated. Please run "brv login" first.')
      return
    }

    // Business logic
    const selection = await this.promptForSelection()
    // ... rest of logic
  }
}
```

## 3. Simplify Command

The command becomes a thin wrapper that wires dependencies:

```typescript
export default class MyCommand extends Command {
  protected createUseCase(): IMyUseCase {
    return new MyUseCase(
      new FsFileService(),
      new OclifTerminal(this),
      // ... wire up dependencies
    )
  }

  public async run(): Promise<void> {
    await this.createUseCase().run()
  }
}
```

## 4. Test Setup

### Testable Use Case

Override prompts to return mock values:

```typescript
interface TestableUseCaseOptions {
  fileService: IFileService
  terminal: ITerminal
  mockSelection: string
  // ... other mocks
}

class TestableUseCase extends MyUseCase {
  private readonly mockSelection: string

  constructor(options: TestableUseCaseOptions) {
    super(options.fileService, options.terminal)
    this.mockSelection = options.mockSelection
  }

  protected async promptForSelection(): Promise<string> {
    return this.mockSelection
  }
}
```

### Testable Command

Inject use case directly (avoid parameter forwarding):

```typescript
class TestableCommand extends MyCommand {
  constructor(
    private readonly useCase: IMyUseCase,
    config: Config,
  ) {
    super([], config)
  }

  protected createUseCase(): IMyUseCase {
    return this.useCase
  }
}
```

### Test Usage

Capture log messages to verify user-facing output:

```typescript
function createTestCommand(flags: Flags, logMessages?: string[]): TestableCommand {
  const useCase = new TestableUseCase({
    fileService: stubbedFileService,
    terminal: createMockTerminal({
      log(msg?: string) {
        if (logMessages && msg) {
          logMessages.push(msg)
        }
      },
    }),
    mockSelection: 'expected value',
  })
  return new TestableCommand(useCase, config)
}

it('should exit early if not initialized', async () => {
  configStore.read.resolves()

  const logMessages: string[] = []
  const command = createTestCommand(defaultFlags, logMessages)

  await command.run()

  // Verify user-facing message was displayed
  expect(logMessages.some((msg) => msg.includes('Not initialized'))).to.be.true
  // Verify early exit (subsequent steps not called)
  expect(tokenStore.load.called).to.be.false
})

it('should do something successfully', async () => {
  configStore.read.resolves(validConfig)
  tokenStore.load.resolves(validToken)

  const command = createTestCommand(defaultFlags)
  await command.run()

  expect(stubbedFileService.write.calledOnce).to.be.true
})
```

## Key Points

| Layer | Responsibility |
|-------|----------------|
| Command | Thin wrapper, wires dependencies, delegates to use case |
| Use Case | All business logic, prompts, orchestration, error handling |
| Interface | Abstraction for testability |

- Use options object for testable classes to avoid `max-params` lint errors
- Inject pre-configured use case into testable command (don't forward parameters)
- Make prompt methods `protected` (not `private`) to allow test overrides
- Use `terminal.log()` + `return` for validation errors (user-friendly, no stack traces)
- Capture log messages in tests to verify user-facing output and early exit behavior

## File Structure

```
src/
  commands/
    my-command.ts           # Thin command wrapper
  core/
    interfaces/
      usecase/
        i-my-use-case.ts    # Interface
  infra/
    usecase/
      my-use-case.ts        # Implementation

test/
  commands/
    my-command.test.ts      # Tests with TestableUseCase + TestableCommand
```
