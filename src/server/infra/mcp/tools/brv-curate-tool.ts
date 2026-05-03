import type {ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {waitForConnectedClient} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import {TransportTaskEventNames} from '../../../core/domain/transport/schemas.js'
import {associateProjectWithRetry, type McpStartupProjectContext, resolveMcpTaskContext} from './mcp-project-context.js'
import {resolveClientCwd} from './resolve-client-cwd.js'
import {cwdField} from './shared-schema.js'
import {waitForTaskResult} from './task-result-waiter.js'

export const BrvCurateInputSchema = z.object({
  context: z
    .string()
    .optional()
    .describe(
      'Knowledge to store: patterns, decisions, errors, or insights about the codebase. Required unless files or folder are provided.',
    ),
  cwd: cwdField,
  files: z
    .array(z.string())
    .max(5)
    .optional()
    .describe(
      'Optional file paths with critical context to include (max 5 files). Required if context and folder not provided.',
    ),
  folder: z
    .string()
    .optional()
    .describe(
      'Folder path to pack and analyze (triggers folder pack flow). When provided, the entire folder will be analyzed and curated. Takes precedence over files.',
    ),
  wait: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When true (default), block until the curate completes so the caller can read the result back via brv-query. Set to false only when you do not need to query the just-curated content in the same turn.',
    ),
})

type McpTextResponse = {
  content: Array<{text: string; type: 'text'}>
  isError?: boolean
}

function textResponse(text: string, options?: {isError?: boolean}): McpTextResponse {
  return {
    content: [{text, type: 'text'}],
    ...(options?.isError ? {isError: true} : {}),
  }
}

/**
 * Registers the brv-curate tool with the MCP server.
 *
 * Stores context to the ByteRover context tree. Defaults to blocking until
 * the curate commits so callers can immediately query the result; pass
 * `wait: false` for fire-and-forget.
 */
export function registerBrvCurateTool(
  server: McpServer,
  getClient: () => ITransportClient | undefined,
  getWorkingDirectory: () => string | undefined,
  getStartupProjectContext: () => McpStartupProjectContext | undefined,
): void {
  server.registerTool(
    'brv-curate',
    {
      description: `Stores a decision, rationale, or convention to the ByteRover memory tree so it's available in future sessions on this project.

USE PROACTIVELY after:
- Making an architectural choice ("we'll do X because Y")
- Resolving a tricky bug with a non-obvious cause
- Establishing a convention ("going forward, all X should Y")
- When the user says "remember this", "let's standardize on X", or "make a note that..."

DO NOT CURATE:
- Code itself (lives in git)
- Trivial fixes or one-off implementation details
- Information available in public docs

Always confirm with the user before curating. Defaults to blocking until the curate commits — set wait=false for fire-and-forget when you do not need to query the result in the same turn.`,
      inputSchema: BrvCurateInputSchema,
      title: 'ByteRover Curate',
    },
    async ({
      context,
      cwd,
      files,
      folder,
      wait = true,
    }: {
      context?: string
      cwd?: string
      files?: string[]
      folder?: string
      wait?: boolean
    }) => {
      if (!context?.trim() && !files?.length && !folder?.trim()) {
        return textResponse('Error: Either context, files, folder, or cwd must be provided', {isError: true})
      }

      const cwdResult = resolveClientCwd(cwd, getWorkingDirectory)
      if (!cwdResult.success) {
        return textResponse(cwdResult.error, {isError: true})
      }

      const client = await waitForConnectedClient(getClient)
      if (!client) {
        return textResponse('Error: Not connected to the daemon. Connection timed out. Ensure "brv" is running.', {
          isError: true,
        })
      }

      const hasFolder = Boolean(folder?.trim())
      const taskType = hasFolder ? 'curate-folder' : 'curate'

      const abort = new AbortController()
      const taskId = randomUUID()
      const resolvedContent = context?.trim() ? context : ''
      // Register listener before task:create to avoid races where the task
      // completes before we attach. Abort on early failure to release listeners.
      const resultPromise = wait ? waitForTaskResult(client, taskId, undefined, abort.signal) : undefined

      try {
        const taskContext = resolveMcpTaskContext(cwdResult.clientCwd, getStartupProjectContext())
        if (!getWorkingDirectory()) {
          await associateProjectWithRetry(client, taskContext.projectRoot)
        }

        const ack = await client.requestWithAck<{logId?: string; taskId: string}>(TransportTaskEventNames.CREATE, {
          clientCwd: cwdResult.clientCwd,
          content: resolvedContent,
          projectPath: taskContext.projectRoot,
          taskId,
          type: taskType,
          worktreeRoot: taskContext.worktreeRoot,
          ...(hasFolder && folder ? {folderPath: folder} : {}),
          ...(!hasFolder && files?.length ? {files} : {}),
        })

        if (resultPromise) await resultPromise

        const idSuffix = ack?.logId ? `(Task: ${taskId} · Log: ${ack.logId})` : `(Task: ${taskId})`
        const message = resultPromise
          ? `✓ Context curated successfully. ${idSuffix}`
          : `✓ Context queued for processing. ${idSuffix}`

        return textResponse(message)
      } catch (error) {
        abort.abort()
        // Swallow the abort rejection so we don't surface a misleading second error.
        if (resultPromise) resultPromise.catch(() => {})
        const reason = error instanceof Error ? error.message : String(error)
        return textResponse(`Error: ${reason}`, {isError: true})
      }
    },
  )
}
