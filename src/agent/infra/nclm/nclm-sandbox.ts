/* eslint-disable camelcase */
import vm from 'node:vm'

import type {MemoryStore} from './memory-store.js'

import {createMemoryStoreService} from './memory-store-service.js'

/**
 * Result from executing code in the NCLM sandbox.
 */
export interface NCLMSandboxResult {
  /** Final answer set by FINAL() or FINAL_VAR() */
  finalAnswer?: string
  /** Return value of the last expression */
  returnValue?: unknown
  /** Error output */
  stderr: string
  /** Console output */
  stdout: string
}

/**
 * Callbacks for LLM sub-calls from within sandbox code.
 */
export interface NCLMSandboxCallbacks {
  /** Plain LLM call (no memory, no iteration) */
  llmQuery?: (prompt: string) => Promise<string>
  /** Recursive NCLM call (own memory + iteration) */
  nclmQuery?: (prompt: string) => Promise<string>
}

/**
 * Lightweight code execution sandbox for SDK mode.
 *
 * Provides memory_* functions bound to a MemoryStore, FINAL/FINAL_VAR
 * for signaling completion, and optional llm_query/nclm_query callbacks.
 * Namespace is restored after each execute() call (RLM pattern).
 */
export class NCLMSandbox {
  private readonly callbacks: NCLMSandboxCallbacks
  private readonly context: vm.Context
  private finalAnswer?: string
  private readonly memoryService: ReturnType<typeof createMemoryStoreService>
  private stdoutBuffer: string[] = []

  constructor(memoryStore: MemoryStore, callbacks?: NCLMSandboxCallbacks) {
    this.callbacks = callbacks ?? {}
    this.memoryService = createMemoryStoreService(memoryStore)

    // Build the initial context with all sandbox functions
    this.context = vm.createContext({
      // Console capture
      console: {
        error: (...args: unknown[]) => { this.stdoutBuffer.push(args.map(String).join(' ')) },
        log: (...args: unknown[]) => { this.stdoutBuffer.push(args.map(String).join(' ')) },
        warn: (...args: unknown[]) => { this.stdoutBuffer.push(args.map(String).join(' ')) },
      },
    })

    // Inject all functions into the context
    this.injectFunctions()
  }

  /**
   * Execute code in the sandbox.
   *
   * Memory_* functions are available directly (no tools. prefix).
   * FINAL(value) / FINAL_VAR(name) signal completion.
   * Namespace is restored after each call.
   */
  execute(code: string): NCLMSandboxResult {
    this.finalAnswer = undefined
    this.stdoutBuffer = []
    let stderr = ''
    let returnValue: unknown

    try {
      returnValue = vm.runInContext(code, this.context, {
        displayErrors: true,
        timeout: 30_000,
      })
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error)
    }

    // Restore reserved functions in case code overwrote them
    this.injectFunctions()

    return {
      finalAnswer: this.finalAnswer,
      returnValue,
      stderr,
      stdout: this.stdoutBuffer.join('\n'),
    }
  }

  private injectFunctions(): void {
    const svc = this.memoryService

    // Memory operations (direct names, no tools. prefix)
    this.context.memory_write = (title: string, content: string, tags?: string[], importance?: number) =>
      svc.write(title, content, tags, importance)
    this.context.memory_update = (id: string, fields: Record<string, unknown>) =>
      svc.update(id, fields)
    this.context.memory_search = (query: string, topK?: number, tags?: string[]) =>
      svc.search(query, topK, tags)
    this.context.memory_read = (id: string) => svc.read(id)
    this.context.memory_list = (params?: Record<string, unknown>) => svc.list(params)
    this.context.memory_latest = (tag?: string) => svc.latest(tag)
    this.context.memory_free = (id: string) => svc.free(id)
    this.context.memory_archive = (id: string) => svc.archive(id)
    this.context.memory_compact = (tag?: string) => svc.compact(tag)
    this.context.memory_stats = () => svc.stats()

    // FINAL / FINAL_VAR
    this.context.FINAL = (value: unknown) => {
      this.finalAnswer = String(value)
    }

    this.context.FINAL_VAR = (varName: string) => {
      if (!(varName in this.context)) {
        throw new Error(`Variable "${varName}" not found in sandbox`)
      }

      this.finalAnswer = String(this.context[varName])
    }

    // LLM sub-calls
    this.context.llm_query = (prompt: string) => {
      if (!this.callbacks.llmQuery) {
        throw new Error('llm_query not available — no callback provided')
      }

      return this.callbacks.llmQuery(prompt)
    }

    this.context.nclm_query = (prompt: string) => {
      if (!this.callbacks.nclmQuery) {
        throw new Error('nclm_query not available — no callback provided')
      }

      return this.callbacks.nclmQuery(prompt)
    }
  }
}
