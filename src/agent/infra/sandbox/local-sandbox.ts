import vm from 'node:vm'

import type { EnvironmentContext } from '../../core/domain/environment/types.js'
import type { REPLResult, SandboxConfig } from '../../core/domain/sandbox/types.js'
import type { ToolsSDK } from './tools-sdk.js'

import { ALLOWED_GLOBALS, ALLOWED_PACKAGES, DEFAULT_SANDBOX_TIMEOUT } from '../../core/domain/sandbox/constants.js'

type EsbuildModule = typeof import('esbuild')

/**
 * Configuration options for LocalSandbox.
 */
export interface LocalSandboxOptions {
  /** Environment context for env.* properties */
  environmentContext?: EnvironmentContext
  /** Initial context variables to inject */
  initialContext?: Record<string, unknown>
  /** Tools SDK for file system operations (injected as `tools` in context) */
  toolsSDK?: ToolsSDK
}

/**
 * Detect if code contains TypeScript-specific syntax.
 */
function detectTypeScript(code: string): boolean {
  const tsPatterns = [
    /:\s*(string|number|boolean|any|void|never|unknown)\b/, // Type annotations
    /interface\s+\w+/, // Interface declarations
    /type\s+\w+\s*=/, // Type aliases
    /as\s+(string|number|boolean|any|unknown|\w+)/, // Type assertions
    /:\s*\w+\[\]/, // Array types
    /<[A-Z]\w*>/, // Generic types (must start with uppercase to avoid JSX false positives)
  ]
  return tsPatterns.some((pattern) => pattern.test(code))
}

/**
 * Cached esbuild module for transpilation.
 */
let esbuildModule: EsbuildModule | undefined

/**
 * Transpile TypeScript to JavaScript using esbuild.
 */
function transpileTypeScript(code: string): string {
  if (!esbuildModule) {
    // Dynamic import esbuild only when needed
    // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module, no-undef
    esbuildModule = require('esbuild') as EsbuildModule
  }

  const result = esbuildModule.transformSync(code, {
    format: 'cjs',
    loader: 'ts',
    target: 'es2022',
  })
  return result.code
}

/**
 * Load whitelisted packages for sandbox.
 * Packages are loaded lazily and cached.
 */
const packageCache = new Map<string, unknown>()

function loadAllowedPackages(): Record<string, unknown> {
  const packages: Record<string, unknown> = {}

  for (const pkgName of ALLOWED_PACKAGES) {
    if (!packageCache.has(pkgName)) {
      try {
        // Dynamic import of whitelisted packages
        // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module, no-undef
        packageCache.set(pkgName, require(pkgName))
      } catch {
        // Package not installed - skip silently
        packageCache.set(pkgName, undefined)
      }
    }

    const pkg = packageCache.get(pkgName)
    if (pkg !== undefined) {
      // Convert package name to camelCase for easier access
      // e.g., 'date-fns' -> 'dateFns', 'change-case' -> 'changeCase'
      const camelCaseName = pkgName.replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
      packages[camelCaseName] = pkg
      // Also keep original name
      packages[pkgName.replaceAll('-', '_')] = pkg
    }
  }

  return packages
}

/**
 * Local sandbox for code execution using Node.js vm module.
 * Provides isolated JavaScript/TypeScript execution with security controls.
 */
export class LocalSandbox {
  private context: vm.Context
  private errorBuffer: string[] = []
  private outputBuffer: string[] = []

  constructor(options: LocalSandboxOptions = {}) {
    const { environmentContext, initialContext = {}, toolsSDK } = options

    // Create safe console that captures output
    const safeConsole = {
      debug: (...args: unknown[]) => this.outputBuffer.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => this.errorBuffer.push(args.map(String).join(' ')),
      info: (...args: unknown[]) => this.outputBuffer.push(args.map(String).join(' ')),
      log: (...args: unknown[]) => this.outputBuffer.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => this.errorBuffer.push(args.map(String).join(' ')),
    }

    // Load whitelisted packages
    const packages = loadAllowedPackages()

    // Build sandbox context with allowed globals
    const sandbox: Record<string, unknown> = {
      console: safeConsole,
      packages, // Make packages available as `packages.lodash`, etc.
      ...packages, // Also spread at top level for convenience: `lodash`, `dateFns`, etc.
      ...initialContext,
    }

    // Inject Tools SDK if provided (for file system operations)
    if (toolsSDK) {
      sandbox.tools = toolsSDK
    }

    // Inject environment context as `env` object if provided
    if (environmentContext) {
      sandbox.env = {
        brvStructure: environmentContext.brvStructure,
        fileTree: environmentContext.fileTree,
        isGitRepository: environmentContext.isGitRepository,
        nodeVersion: environmentContext.nodeVersion,
        osVersion: environmentContext.osVersion,
        platform: environmentContext.platform,
        workingDirectory: environmentContext.workingDirectory,
      }
    }

    // Add allowed built-in globals
    for (const name of ALLOWED_GLOBALS) {
      if (name !== 'console' && name in globalThis) {
        sandbox[name] = (globalThis as Record<string, unknown>)[name]
      }
    }

    this.context = vm.createContext(sandbox)
  }

  /**
   * Execute code in the sandbox.
   * Supports both synchronous and asynchronous code execution.
   *
   * @param code - JavaScript or TypeScript code to execute
   * @param config - Execution configuration
   * @returns Execution result
   */
  async execute(code: string, config?: SandboxConfig): Promise<REPLResult> {
    this.outputBuffer = []
    this.errorBuffer = []

    const timeout = config?.timeout ?? DEFAULT_SANDBOX_TIMEOUT
    const startTime = performance.now()

    let returnValue: unknown
    let processedCode = code

    try {
      // Determine language (auto-detect if not specified)
      const isTypeScript =
        config?.language === 'typescript' || (config?.language !== 'javascript' && detectTypeScript(code))

      // Transpile TypeScript if needed
      if (isTypeScript) {
        processedCode = transpileTypeScript(code)
      }

      returnValue = vm.runInContext(processedCode, this.context, {
        displayErrors: true,
        timeout,
      })

      // If the return value is a Promise or thenable, await it with timeout
      // Use duck-typing to handle Promises from vm context (which may have different constructor)
      const isPromiseLike =
        returnValue !== null &&
        typeof returnValue === 'object' &&
        typeof (returnValue as { then?: unknown }).then === 'function'

      if (isPromiseLike) {
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        try {
          returnValue = await Promise.race([
            returnValue as Promise<unknown>,
            new Promise((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error('Async execution timeout')), timeout)
            }),
          ])
        } finally {
          // Always clear the timeout to prevent resource leaks
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId)
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      this.errorBuffer.push(errorMessage)
    }

    const executionTime = performance.now() - startTime

    // Extract current context state (excluding functions, built-ins, and injected services)
    const locals: Record<string, unknown> = {}
    const excludedKeys = new Set(['context', 'env', 'packages', 'tools'])
    for (const key of Object.keys(this.context)) {
      const isAllowedGlobal = (ALLOWED_GLOBALS as readonly string[]).includes(key)
      const isPackage = key in loadAllowedPackages()
      const isExcluded = excludedKeys.has(key)

      if (!isAllowedGlobal && !isPackage && !isExcluded && typeof this.context[key] !== 'function') {
        try {
          // Only include JSON-serializable values
          JSON.stringify(this.context[key])
          locals[key] = this.context[key]
        } catch {
          locals[key] = '[Non-serializable]'
        }
      }
    }

    return {
      executionTime,
      locals,
      returnValue,
      stderr: this.errorBuffer.join('\n'),
      stdout: this.outputBuffer.join('\n'),
    }
  }

  /**
   * Get current context state.
   *
   * @returns Copy of current context
   */
  getContext(): Record<string, unknown> {
    return { ...this.context }
  }

  /**
   * Update context with new values.
   *
   * @param updates - Key-value pairs to add to context
   */
  updateContext(updates: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(updates)) {
      this.context[key] = value
    }
  }
}
