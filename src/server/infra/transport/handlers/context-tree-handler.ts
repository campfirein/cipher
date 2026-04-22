import {mkdir, readdir, writeFile} from 'node:fs/promises'
import {dirname, join, relative} from 'node:path'

import type {IContextFileReader} from '../../../core/interfaces/context-tree/i-context-file-reader.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../core/interfaces/services/i-git-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  ContextTreeEvents,
  type ContextTreeGetFileMetadataRequest,
  type ContextTreeGetFileMetadataResponse,
  type ContextTreeGetFileRequest,
  type ContextTreeGetFileResponse,
  type ContextTreeGetHistoryRequest,
  type ContextTreeGetHistoryResponse,
  type ContextTreeGetNodesRequest,
  type ContextTreeGetNodesResponse,
  type ContextTreeNodeDTO,
  type ContextTreeUpdateFileRequest,
  type ContextTreeUpdateFileResponse,
} from '../../../../shared/transport/events/context-tree-events.js'
import {ARCHIVE_DIR, DEFAULT_BRANCH, README_FILE, SNAPSHOT_FILE} from '../../../constants.js'
import {isExcludedFromSync} from '../../context-tree/derived-artifact.js'
import {toUnixPath} from '../../context-tree/path-utils.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

const DEFAULT_HISTORY_LIMIT = 10
const SCAN_SKIP_NAMES = new Set(['.git', '.gitignore', ARCHIVE_DIR, SNAPSHOT_FILE])

export interface ContextTreeHandlerDeps {
  contextFileReader: IContextFileReader
  contextTreeService: IContextTreeService
  gitService: Pick<IGitService, 'log'>
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

export class ContextTreeHandler {
  private readonly contextFileReader: IContextFileReader
  private readonly contextTreeService: IContextTreeService
  private readonly gitService: Pick<IGitService, 'log'>
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: ContextTreeHandlerDeps) {
    this.contextFileReader = deps.contextFileReader
    this.contextTreeService = deps.contextTreeService
    this.gitService = deps.gitService
    this.resolveProjectPath = deps.resolveProjectPath
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<ContextTreeGetNodesRequest, ContextTreeGetNodesResponse>(
      ContextTreeEvents.GET_NODES,
      (data, clientId) => this.handleGetNodes(data, clientId),
    )

    this.transport.onRequest<ContextTreeGetFileRequest, ContextTreeGetFileResponse>(
      ContextTreeEvents.GET_FILE,
      (data, clientId) => this.handleGetFile(data, clientId),
    )

    this.transport.onRequest<ContextTreeUpdateFileRequest, ContextTreeUpdateFileResponse>(
      ContextTreeEvents.UPDATE_FILE,
      (data, clientId) => this.handleUpdateFile(data, clientId),
    )

    this.transport.onRequest<ContextTreeGetHistoryRequest, ContextTreeGetHistoryResponse>(
      ContextTreeEvents.GET_HISTORY,
      (data, clientId) => this.handleGetHistory(data, clientId),
    )

    this.transport.onRequest<ContextTreeGetFileMetadataRequest, ContextTreeGetFileMetadataResponse>(
      ContextTreeEvents.GET_FILE_METADATA,
      (data, clientId) => this.handleGetFileMetadata(data, clientId),
    )
  }

  private async handleGetFile(
    data: ContextTreeGetFileRequest,
    clientId: string,
  ): Promise<ContextTreeGetFileResponse> {
    const projectPath = this.resolveProject(data, clientId)
    const fileContent = await this.contextFileReader.read(data.path, projectPath)

    if (!fileContent) {
      throw new Error(`File not found: ${data.path}`)
    }

    return {
      file: {
        content: fileContent.content,
        path: fileContent.path,
        tags: fileContent.tags,
        title: fileContent.title,
      },
    }
  }

  private async handleGetFileMetadata(
    data: ContextTreeGetFileMetadataRequest,
    clientId: string,
  ): Promise<ContextTreeGetFileMetadataResponse> {
    const projectPath = this.resolveProject(data, clientId)
    const contextTreeDir = this.contextTreeService.resolvePath(projectPath)

    const files = await Promise.all(
      data.paths.map(async (filePath) => {
        try {
          const commits = await this.gitService.log({depth: 1, directory: contextTreeDir, filepath: filePath})
          const commit = commits[0]
          return {
            lastUpdatedBy: commit?.author.name,
            lastUpdatedWhen: commit?.timestamp.toISOString(),
            path: filePath,
          }
        } catch {
          return {path: filePath}
        }
      }),
    )

    return {files}
  }

  private async handleGetHistory(
    data: ContextTreeGetHistoryRequest,
    clientId: string,
  ): Promise<ContextTreeGetHistoryResponse> {
    const projectPath = this.resolveProject(data, clientId)
    const contextTreeDir = this.contextTreeService.resolvePath(projectPath)
    const limit = data.limit ?? DEFAULT_HISTORY_LIMIT

    // Cursor-based pagination:
    // - No cursor: fetch limit + 1 from HEAD
    // - With cursor: fetch limit + 2 from cursor (skip first = cursor itself, +1 for hasMore check)
    const depth = data.cursor ? limit + 2 : limit + 1
    const ref = data.cursor ?? undefined

    const allCommits = await this.gitService.log({
      depth,
      directory: contextTreeDir,
      filepath: data.path,
      ref,
    })

    // Skip the cursor commit itself when paginating
    const commits = data.cursor ? allCommits.slice(1) : allCommits
    const hasMore = commits.length > limit
    const pageCommits = hasMore ? commits.slice(0, limit) : commits
    const nextCursor = hasMore ? pageCommits.at(-1)?.sha : undefined

    return {
      commits: pageCommits.map((c) => ({
        author: c.author,
        message: c.message,
        sha: c.sha,
        timestamp: c.timestamp.toISOString(),
      })),
      hasMore,
      nextCursor,
    }
  }

  private async handleGetNodes(
    data: ContextTreeGetNodesRequest,
    clientId: string,
  ): Promise<ContextTreeGetNodesResponse> {
    const projectPath = this.resolveProject(data, clientId)
    const contextTreeDir = this.contextTreeService.resolvePath(projectPath)

    try {
      const nodes = await this.scanDirectory(contextTreeDir, contextTreeDir, true)
      return {branch: DEFAULT_BRANCH, nodes}
    } catch {
      return {branch: DEFAULT_BRANCH, nodes: []}
    }
  }

  private async handleUpdateFile(
    data: ContextTreeUpdateFileRequest,
    clientId: string,
  ): Promise<ContextTreeUpdateFileResponse> {
    const projectPath = this.resolveProject(data, clientId)
    const contextTreeDir = this.contextTreeService.resolvePath(projectPath)
    const fullPath = join(contextTreeDir, data.path)

    // Guard against path traversal
    const resolved = relative(contextTreeDir, fullPath)
    if (resolved.startsWith('..') || resolved.startsWith('/')) {
      throw new Error('Path traversal not allowed')
    }

    await mkdir(dirname(fullPath), {recursive: true})
    await writeFile(fullPath, data.content, 'utf8')

    return {success: true}
  }

  /** Resolves project path from explicit request field or client registration fallback. */
  private resolveProject(data: undefined | {projectPath?: string}, clientId: string): string {
    return data?.projectPath ?? resolveRequiredProjectPath(this.resolveProjectPath, clientId)
  }

  private async scanDirectory(
    currentDir: string,
    rootDir: string,
    isRoot: boolean,
  ): Promise<ContextTreeNodeDTO[]> {
    let entries
    try {
      entries = await readdir(currentDir, {withFileTypes: true})
    } catch {
      return []
    }

    const filtered = entries.filter((e) => !SCAN_SKIP_NAMES.has(e.name))

    const dirEntries = filtered.filter((e) => e.isDirectory())
    const fileEntries = filtered.filter((e) => e.isFile())

    // Scan subdirectories in parallel
    const dirResults = await Promise.all(
      dirEntries.map(async (entry) => {
        const children = await this.scanDirectory(join(currentDir, entry.name), rootDir, false)
        if (children.length === 0) return
        return {
          children,
          name: entry.name,
          path: toUnixPath(relative(rootDir, join(currentDir, entry.name))),
          type: 'tree' as const,
        }
      }),
    )

    const nodes: ContextTreeNodeDTO[] = []

    for (const dir of dirResults) {
      if (dir) nodes.push(dir)
    }

    for (const entry of fileEntries) {
      if (isRoot && entry.name === README_FILE) continue
      const relativePath = toUnixPath(relative(rootDir, join(currentDir, entry.name)))
      if (isExcludedFromSync(relativePath)) continue
      nodes.push({name: entry.name, path: relativePath, type: 'blob'})
    }

    // Sort: folders first, then alphabetically
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }
}
