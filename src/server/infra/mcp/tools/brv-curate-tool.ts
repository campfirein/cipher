import type {ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import {TransportClientEventNames} from '../../../core/domain/transport/schemas.js'
import {resolveClientCwd} from './resolve-client-cwd.js'

export const BrvCurateInputSchema = z
  .object({
    context: z
      .string()
      .optional()
      .describe(
        'Knowledge to store: patterns, decisions, errors, or insights about the codebase. Required unless files or folder are provided.',
      ),
    cwd: z
      .string()
      .optional()
      .describe(
        'Working directory of the project (absolute path). ' +
          'Required when the MCP server runs in global mode (e.g., Windsurf). ' +
          'Optional in project mode — defaults to the project directory.',
      ),
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
  })
  .refine((data) => Boolean(data.context?.trim()) || Boolean(data.files?.length) || Boolean(data.folder?.trim()), {
    message: 'Either context, files, or folder must be provided',
  })

/**
 * Registers the brv-curate tool with the MCP server.
 *
 * This tool allows coding agents to store context to the ByteRover context tree.
 * Use it to save patterns, architectural decisions, error solutions, or insights.
 *
 * Uses fire-and-forget pattern: returns immediately after queueing the task.
 * The curation is processed asynchronously by the ByteRover agent.
 */
export function registerBrvCurateTool(
  server: McpServer,
  getClient: () => ITransportClient | undefined,
  getWorkingDirectory: () => string | undefined,
): void {
  server.registerTool(
    'brv-curate',
    {
      description:
        'Store context to the ByteRover context tree. Save patterns, decisions, or insights. ' +
        'Curation is processed asynchronously — the tool returns immediately after queueing.',
      inputSchema: BrvCurateInputSchema,
      title: 'ByteRover Curate',
    },
    async ({context, cwd, files, folder}: {context?: string; cwd?: string; files?: string[]; folder?: string}) => {
      // Resolve clientCwd: explicit cwd param > server working directory
      const cwdResult = resolveClientCwd(cwd, getWorkingDirectory)
      if (!cwdResult.success) {
        return {
          content: [{text: cwdResult.error, type: 'text' as const}],
          isError: true,
        }
      }

      const client = getClient()
      if (!client) {
        return {
          content: [{text: 'Error: Not connected to ByteRover instance. Run "brv" first.', type: 'text' as const}],
          isError: true,
        }
      }

      // Check connection state before making request
      const state = client.getState()
      if (state !== 'connected') {
        return {
          content: [
            {
              text: `Error: Socket not connected. Current state: ${state}. Ensure "brv" is running.`,
              type: 'text' as const,
            },
          ],
          isError: true,
        }
      }

      // In global mode, associate client with the resolved project.
      // Fire-and-forget: server handler is idempotent.
      if (!getWorkingDirectory()) {
        client
          .requestWithAck(TransportClientEventNames.ASSOCIATE_PROJECT, {
            projectPath: cwdResult.clientCwd,
          })
          .catch(() => {})
      }

      try {
        const taskId = randomUUID()

        // Create task via transport (same pattern as brv curate command)
        // Use provided context, or empty string for file-only/folder-only mode
        const resolvedContent = context?.trim() ? context : ''

        // Determine task type: folder pack takes precedence over file-based curate
        const hasFolder = Boolean(folder?.trim())
        const taskType = hasFolder ? 'curate-folder' : 'curate'

        await client.requestWithAck('task:create', {
          clientCwd: cwdResult.clientCwd,
          content: resolvedContent,
          taskId,
          type: taskType,
          ...(hasFolder && folder ? {folderPath: folder} : {}),
          ...(!hasFolder && files?.length ? {files} : {}),
        })

        // Fire-and-forget: return immediately after task is queued
        // Curation is processed asynchronously by the ByteRover agent
        const modeDescription = hasFolder ? 'folder pack' : 'curation'
        return {
          content: [
            {
              text: `✓ Context queued for ${modeDescription} (taskId: ${taskId}). The curation will be processed asynchronously.`,
              type: 'text' as const,
            },
          ],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{text: `Error: ${message}`, type: 'text' as const}],
          isError: true,
        }
      }
    },
  )
}
