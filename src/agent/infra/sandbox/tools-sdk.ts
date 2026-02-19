import type {
  FileContent,
  GlobResult,
  ListDirectoryResult,
  SearchResult,
  WriteResult,
} from '../../core/domain/file-system/types.js'
import type {
  CurateOperation,
  CurateOptions,
  CurateResult,
  DetectDomainsInput,
  DetectDomainsResult,
  ICurateService,
} from '../../core/interfaces/i-curate-service.js'
import type {IFileSystem} from '../../core/interfaces/i-file-system.js'
import type {ISandboxService} from '../../core/interfaces/i-sandbox-service.js'
import type {SessionManager} from '../session/session-manager.js'

/**
 * Options for glob operation in ToolsSDK.
 */
export interface GlobOptions {
  /** Case-sensitive pattern matching (default: true) */
  caseSensitive?: boolean
  /** Maximum number of results to return (default: 1000) */
  maxResults?: number
  /** Base directory to search from (defaults to working directory) */
  path?: string
}

/**
 * Options for grep operation in ToolsSDK.
 */
export interface GrepOptions {
  /** Perform case-insensitive search (default: false) */
  caseInsensitive?: boolean
  /** Number of context lines before and after each match (default: 0) */
  contextLines?: number
  /** Glob pattern to filter files (e.g., "*.ts") */
  glob?: string
  /** Maximum number of results to return (default: 100) */
  maxResults?: number
  /** Directory to search in (defaults to working directory) */
  path?: string
}

/**
 * Options for readFile operation in ToolsSDK.
 */
export interface ReadFileOptions {
  /** Maximum number of lines to read (default: 2000) */
  limit?: number
  /** Starting line number (1-based) */
  offset?: number
}

/**
 * Options for writeFile operation in ToolsSDK.
 */
export interface WriteFileOptions {
  /** Create parent directories if they don't exist (default: false) */
  createDirs?: boolean
}

/**
 * Options for listDirectory operation in ToolsSDK.
 */
export interface ListDirectoryOptions {
  /** Additional glob patterns to ignore */
  ignore?: string[]
  /** Maximum number of files to return (default: 100) */
  maxResults?: number
}

/**
 * Options for searchKnowledge operation in ToolsSDK.
 */
export interface SearchKnowledgeOptions {
  /** Maximum number of results to return (default: 10) */
  limit?: number
}

/**
 * Result type for searchKnowledge operation.
 */
export interface SearchKnowledgeResult {
  message: string
  results: Array<{
    /** Number of other memories that reference this one */
    backlinkCount?: number
    excerpt: string
    path: string
    /** Top backlink source paths (max 3) */
    relatedPaths?: string[]
    score: number
    /** Symbol kind: 'domain' | 'topic' | 'subtopic' | 'context' */
    symbolKind?: string
    /** Resolved hierarchical path in the symbol tree */
    symbolPath?: string
    title: string
  }>
  totalFound: number
}

/**
 * Service interface for search knowledge functionality.
 * Allows injection of knowledge search capability into ToolsSDK.
 */
export interface ISearchKnowledgeService {
  search(query: string, options?: SearchKnowledgeOptions): Promise<SearchKnowledgeResult>
}

/**
 * Tools SDK interface exposed to sandbox code execution.
 * Provides async file system operations for programmatic access.
 */
export interface ToolsSDK {
  /**
   * Spawn a sub-agent to process a prompt with full code_exec access.
   * The sub-agent runs in an isolated context (does not pollute parent).
   * Only the final response string flows back.
   * @param prompt - Prompt for the sub-agent
   * @param options - Optional limits
   * @param options.maxIterations - Maximum agentic iterations (default: 5)
   * @returns Promise resolving to the sub-agent's final response
   */
  agentQuery(prompt: string, options?: { contextData?: Record<string, unknown>; maxIterations?: number }): Promise<string>

  /**
   * Execute curate operations on knowledge topics.
   * Operations: ADD, UPDATE, MERGE, DELETE
   * @param operations - Array of curate operations to apply
   * @param options - Curate options (basePath defaults to .brv/context-tree)
   * @returns Promise resolving to curate result with applied operations and summary
   */
  curate(operations: CurateOperation[], options?: CurateOptions): Promise<CurateResult>

  /**
   * Detect and validate domains from input data.
   * Use this to analyze text and categorize it into knowledge domains.
   * @param domains - Array of detected domains with text segments
   * @returns Promise resolving to validated domains
   */
  detectDomains(domains: DetectDomainsInput[]): Promise<DetectDomainsResult>

  /**
   * Find files matching a glob pattern.
   * @param pattern - Glob pattern (e.g., "**\/*.ts", "src/**\/*.js")
   * @param options - Glob options
   * @returns Promise resolving to glob result with matched files
   */
  glob(pattern: string, options?: GlobOptions): Promise<GlobResult>

  /**
   * Search file contents for a regex pattern.
   * @param pattern - Regular expression pattern to search for
   * @param options - Grep options
   * @returns Promise resolving to search result with matches
   */
  grep(pattern: string, options?: GrepOptions): Promise<SearchResult>

  /**
   * List files and directories in a tree structure.
   * @param path - Directory path (defaults to working directory)
   * @param options - List options
   * @returns Promise resolving to directory listing
   */
  listDirectory(path?: string, options?: ListDirectoryOptions): Promise<ListDirectoryResult>

  /**
   * Read the contents of a file.
   * @param filePath - Path to the file (absolute or relative)
   * @param options - Read options for pagination
   * @returns Promise resolving to file content
   */
  readFile(filePath: string, options?: ReadFileOptions): Promise<FileContent>

  /**
   * Search the curated knowledge base for relevant topics.
   * @param query - Natural language query string
   * @param options - Search options
   * @returns Promise resolving to search results
   */
  searchKnowledge(query: string, options?: SearchKnowledgeOptions): Promise<SearchKnowledgeResult>

  /**
   * Write content to a file.
   * @param filePath - Absolute path where the file should be written
   * @param content - Content to write
   * @param options - Write options
   * @returns Promise resolving to write result
   */
  writeFile(filePath: string, content: string, options?: WriteFileOptions): Promise<WriteResult>
}

/**
 * Options for creating a Tools SDK instance.
 */
export interface CreateToolsSDKOptions {
  /** Curate service for knowledge curation */
  curateService?: ICurateService
  /** File system service for file operations */
  fileSystem: IFileSystem
  /** Parent session ID for creating child sessions (required for agentQuery) */
  parentSessionId?: string
  /** Sandbox service for variable injection into child sessions (optional, enables contextData in agentQuery) */
  sandboxService?: ISandboxService
  /** Search knowledge service */
  searchKnowledgeService?: ISearchKnowledgeService
  /** Session manager for sub-agent delegation (required for agentQuery) */
  sessionManager?: SessionManager
}

/**
 * Creates a Tools SDK instance for sandbox code execution.
 *
 * The SDK provides async wrapper functions around file system operations,
 * allowing code executed in the sandbox to access file system tools programmatically.
 *
 * @param options - Configuration options for the Tools SDK
 * @returns ToolsSDK instance ready to be injected into sandbox context
 */
export function createToolsSDK(options: CreateToolsSDKOptions): ToolsSDK {
  const {curateService, fileSystem, parentSessionId, sandboxService, searchKnowledgeService, sessionManager} = options
  return {
    async agentQuery(prompt: string, options?: { contextData?: Record<string, unknown>; maxIterations?: number }): Promise<string> {
      if (!sessionManager || !parentSessionId) {
        throw new Error('agentQuery not available — no session manager configured')
      }

      const childSession = await sessionManager.createChildSession(parentSessionId, 'sub-query')
      try {
        // Inject context data as sandbox variables in child session (RLM pattern).
        // This avoids embedding large data directly in the prompt string.
        if (options?.contextData && sandboxService) {
          for (const [key, value] of Object.entries(options.contextData)) {
            sandboxService.setSandboxVariable(childSession.id, key, value)
          }
        }

        const response = await childSession.run(prompt, {
          emitTaskId: false,
          executionContext: {
            commandType: 'query',
            maxIterations: options?.maxIterations ?? 5,
          },
        })

        return response
      } finally {
        await sessionManager.deleteSession(childSession.id)
      }
    },

    async curate(operations: CurateOperation[], options?: CurateOptions): Promise<CurateResult> {
      if (!curateService) {
        return {
          applied: [{
            message: 'Curate service not available.',
            path: '',
            status: 'failed',
            type: 'ADD',
          }],
          summary: {
            added: 0,
            deleted: 0,
            failed: 1,
            merged: 0,
            updated: 0,
          },
        }
      }

      return curateService.curate(operations, options)
    },

    async detectDomains(domains: DetectDomainsInput[]): Promise<DetectDomainsResult> {
      if (!curateService) {
        return {
          domains: [],
        }
      }

      return curateService.detectDomains(domains)
    },

    async glob(pattern: string, options?: GlobOptions): Promise<GlobResult> {
      return fileSystem.globFiles(pattern, {
        caseSensitive: options?.caseSensitive ?? true,
        cwd: options?.path,
        includeMetadata: true,
        maxResults: options?.maxResults ?? 1000,
        respectGitignore: true,
      })
    },

    async grep(pattern: string, options?: GrepOptions): Promise<SearchResult> {
      return fileSystem.searchContent(pattern, {
        caseInsensitive: options?.caseInsensitive ?? false,
        contextLines: options?.contextLines ?? 0,
        cwd: options?.path,
        globPattern: options?.glob,
        maxResults: options?.maxResults ?? 100,
      })
    },

    async listDirectory(path?: string, options?: ListDirectoryOptions): Promise<ListDirectoryResult> {
      return fileSystem.listDirectory(path ?? '.', {
        ignore: options?.ignore,
        maxResults: options?.maxResults ?? 100,
      })
    },

    async readFile(filePath: string, options?: ReadFileOptions): Promise<FileContent> {
      return fileSystem.readFile(filePath, {
        limit: options?.limit,
        offset: options?.offset,
      })
    },

    async searchKnowledge(query: string, options?: SearchKnowledgeOptions): Promise<SearchKnowledgeResult> {
      if (!searchKnowledgeService) {
        return {
          message: 'Search knowledge service not available.',
          results: [],
          totalFound: 0,
        }
      }

      return searchKnowledgeService.search(query, options)
    },

    async writeFile(filePath: string, content: string, options?: WriteFileOptions): Promise<WriteResult> {
      return fileSystem.writeFile(filePath, content, {
        createDirs: options?.createDirs ?? false,
      })
    },
  }
}
