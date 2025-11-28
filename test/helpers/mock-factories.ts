/**
 * Test Mock Factories
 *
 * Centralized factory functions for creating properly-typed test mocks.
 * This approach uses Partial<Type> to explicitly mock only what's needed for tests.
 *
 * Benefits over `as unknown as Type`:
 * - Partial type safety: TypeScript checks stubbed methods exist on the interface
 * - Explicit intent: Clear that we're mocking a subset of the interface
 * - DRY: Reusable across test files
 * - Maintainable: Single source of truth when interfaces change
 * - Compile-time errors: When adding stubs for non-existent methods
 *
 * Trade-offs:
 * - Still requires casting for full type compatibility in test setup
 * - But the cast is centralized and documented, not scattered throughout tests
 */

import type {SinonSandbox} from 'sinon'

import type {CipherAgentServices} from '../../src/core/interfaces/cipher/cipher-services.js'
import type {IBlobStorage} from '../../src/core/interfaces/cipher/i-blob-storage.js'
import type {IHistoryStorage} from '../../src/core/interfaces/cipher/i-history-storage.js'
import type {ILLMService} from '../../src/core/interfaces/cipher/i-llm-service.js'
import type {AgentEventBus} from '../../src/infra/cipher/events/event-emitter.js'
import type {FileSystemService} from '../../src/infra/cipher/file-system/file-system-service.js'
import type {ContextManager} from '../../src/infra/cipher/llm/context/context-manager.js'
import type {MemoryManager} from '../../src/infra/cipher/memory/memory-manager.js'
import type {ProcessService} from '../../src/infra/cipher/process/process-service.js'
import type {SimplePromptFactory} from '../../src/infra/cipher/system-prompt/simple-prompt-factory.js'
import type {ToolManager} from '../../src/infra/cipher/tools/tool-manager.js'
import type {ToolProvider} from '../../src/infra/cipher/tools/tool-provider.js'

/**
 * Creates a mock ContextManager with commonly-used methods stubbed.
 * Uses Partial<ContextManager> internally for type safety on stubbed methods.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock ContextManager (cast to full type for test usage)
 */
export function createMockContextManager<T = unknown>(
  sandbox: SinonSandbox,
  overrides?: Partial<ContextManager<T>>,
): ContextManager<T> {
  const mock: Partial<ContextManager<T>> = {
    clearHistory: sandbox.stub().resolves(),
    getMessages: sandbox.stub().returns([]),
    ...overrides,
  }

  // Cast to full type - test code only calls stubbed methods
  return mock as ContextManager<T>
}

/**
 * Creates a mock ILLMService with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock ILLMService (cast to full type for test usage)
 */
export function createMockLLMService(
  sandbox: SinonSandbox,
  overrides?: Partial<ILLMService>,
): ILLMService {
  const mockContextManager = createMockContextManager(sandbox)

  const mock: Partial<ILLMService> = {
    completeTask: sandbox.stub().resolves('test response'),
    getAllTools: sandbox.stub().resolves({}),
    getConfig: sandbox.stub().returns({
      configuredMaxInputTokens: 1000,
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      model: 'test-model',
      modelMaxInputTokens: 1000,
      provider: 'test-provider',
      router: 'test-router',
    }),
    getContextManager: sandbox.stub().returns(mockContextManager),
    ...overrides,
  }

  return mock as ILLMService
}

/**
 * Creates a mock IBlobStorage with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock IBlobStorage (cast to full type for test usage)
 */
export function createMockBlobStorage(
  sandbox: SinonSandbox,
  overrides?: Partial<IBlobStorage>,
): IBlobStorage {
  const mock: Partial<IBlobStorage> = {
    clear: sandbox.stub().resolves(),
    delete: sandbox.stub().resolves(),
    exists: sandbox.stub().resolves(false),
    list: sandbox.stub().resolves([]),
    retrieve: sandbox.stub().resolves(),
    store: sandbox.stub().resolves({
      content: Buffer.from(''),
      key: 'test-key',
      metadata: {
        contentType: 'application/octet-stream',
        createdAt: new Date(),
        size: 0,
        updatedAt: new Date(),
      },
    }),
    ...overrides,
  }

  return mock as IBlobStorage
}

/**
 * Creates a mock IHistoryStorage with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock IHistoryStorage (cast to full type for test usage)
 */
export function createMockHistoryStorage(
  sandbox: SinonSandbox,
  overrides?: Partial<IHistoryStorage>,
): IHistoryStorage {
  const mock: Partial<IHistoryStorage> = {
    loadHistory: sandbox.stub().resolves([]),
    saveHistory: sandbox.stub().resolves(),
    ...overrides,
  }

  return mock as IHistoryStorage
}

/**
 * Creates a mock FileSystemService with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock FileSystemService (cast to full type for test usage)
 */
export function createMockFileSystemService(
  sandbox: SinonSandbox,
  overrides?: Partial<FileSystemService>,
): FileSystemService {
  const mock: Partial<FileSystemService> = {
    editFile: sandbox.stub().resolves({bytesWritten: 0, replacements: 0}),
    globFiles: sandbox.stub().resolves({files: [], totalMatches: 0}),
    initialize: sandbox.stub().resolves(),
    readFile: sandbox.stub().resolves({content: '', metadata: {lines: 0, size: 0}}),
    searchContent: sandbox.stub().resolves({matches: [], totalMatches: 0}),
    writeFile: sandbox.stub().resolves({bytesWritten: 0, filePath: ''}),
    ...overrides,
  }

  return mock as FileSystemService
}

/**
 * Creates a mock MemoryManager with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock MemoryManager (cast to full type for test usage)
 */
export function createMockMemoryManager(
  sandbox: SinonSandbox,
  overrides?: Partial<MemoryManager>,
): MemoryManager {
  const mock: Partial<MemoryManager> = {
    ...overrides,
  }

  return mock as MemoryManager
}

/**
 * Creates a mock ProcessService with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock ProcessService (cast to full type for test usage)
 */
export function createMockProcessService(
  sandbox: SinonSandbox,
  overrides?: Partial<ProcessService>,
): ProcessService {
  const mock: Partial<ProcessService> = {
    ...overrides,
  }

  return mock as ProcessService
}

/**
 * Creates a mock SimplePromptFactory with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock SimplePromptFactory (cast to full type for test usage)
 */
export function createMockPromptFactory(
  sandbox: SinonSandbox,
  overrides?: Partial<SimplePromptFactory>,
): SimplePromptFactory {
  const mock: Partial<SimplePromptFactory> = {
    ...overrides,
  }

  return mock as SimplePromptFactory
}

/**
 * Creates a mock ToolManager with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock ToolManager (cast to full type for test usage)
 */
export function createMockToolManager(
  sandbox: SinonSandbox,
  overrides?: Partial<ToolManager>,
): ToolManager {
  const mock: Partial<ToolManager> = {
    ...overrides,
  }

  return mock as ToolManager
}

/**
 * Creates a mock ToolProvider with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock ToolProvider (cast to full type for test usage)
 */
export function createMockToolProvider(
  sandbox: SinonSandbox,
  overrides?: Partial<ToolProvider>,
): ToolProvider {
  const mock: Partial<ToolProvider> = {
    ...overrides,
  }

  return mock as ToolProvider
}

/**
 * Creates a mock IPolicyEngine with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock IPolicyEngine (cast to full type for test usage)
 */
export function createMockPolicyEngine(
  sandbox: SinonSandbox,
  overrides?: Partial<CipherAgentServices['policyEngine']>,
): CipherAgentServices['policyEngine'] {
  const mock: Partial<CipherAgentServices['policyEngine']> = {
    addRule: sandbox.stub(),
    evaluate: sandbox.stub().returns({decision: 'ALLOW', reason: 'mock allow'}),
    getRules: sandbox.stub().returns([]),
    removeRule: sandbox.stub(),
    ...overrides,
  }

  return mock as CipherAgentServices['policyEngine']
}

/**
 * Creates a mock IToolScheduler with commonly-used methods stubbed.
 *
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific methods
 * @returns Mock IToolScheduler (cast to full type for test usage)
 */
export function createMockToolScheduler(
  sandbox: SinonSandbox,
  overrides?: Partial<CipherAgentServices['toolScheduler']>,
): CipherAgentServices['toolScheduler'] {
  const mock: Partial<CipherAgentServices['toolScheduler']> = {
    clearHistory: sandbox.stub(),
    execute: sandbox.stub().resolves(),
    getHistory: sandbox.stub().returns([]),
    ...overrides,
  }

  return mock as CipherAgentServices['toolScheduler']
}

/**
 * Creates a properly-typed mock CipherAgentServices
 *
 * @param agentEventBus - Real or mock AgentEventBus instance
 * @param sandbox - Sinon sandbox for creating stubs
 * @param overrides - Optional overrides for specific services
 * @returns Fully-typed mock CipherAgentServices
 */
export function createMockCipherAgentServices(
  agentEventBus: AgentEventBus,
  sandbox: SinonSandbox,
  overrides?: Partial<CipherAgentServices>,
): CipherAgentServices {
  return {
    agentEventBus,
    blobStorage: createMockBlobStorage(sandbox),
    fileSystemService: createMockFileSystemService(sandbox),
    historyStorage: createMockHistoryStorage(sandbox),
    memoryManager: createMockMemoryManager(sandbox),
    policyEngine: createMockPolicyEngine(sandbox),
    processService: createMockProcessService(sandbox),
    promptFactory: createMockPromptFactory(sandbox),
    toolManager: createMockToolManager(sandbox),
    toolProvider: createMockToolProvider(sandbox),
    toolScheduler: createMockToolScheduler(sandbox),
    ...overrides,
  }
}
