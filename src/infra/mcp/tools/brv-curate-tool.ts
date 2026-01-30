import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import type { ITransportClient } from '../../../core/interfaces/transport/index.js'

export const BrvCurateInputSchema = z.object({
  context: z
    .string()
    .optional()
    .describe('Knowledge to store: patterns, decisions, errors, or insights about the codebase. Required unless files are provided.'),
  files: z
    .array(z.string())
    .max(5)
    .optional()
    .describe('Optional file paths with critical context to include (max 5 files). Required if context not provided.'),
}).refine(
  (data) => Boolean(data.context?.trim()) || Boolean(data.files?.length),
  { message: 'Either context or files must be provided'}
)

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
  getWorkingDirectory: () => string,
): void {
  server.registerTool(
    'brv-curate',
    {
      description: 'Store context to the ByteRover context tree. Save patterns, decisions, or insights.',
      inputSchema: BrvCurateInputSchema,
      title: 'ByteRover Curate',
    },
    async ({ context, files }: { context?: string; files?: string[] }) => {
      const client = getClient()
      if (!client) {
        return {
          content: [{ text: 'Error: Not connected to ByteRover instance. Run "brv" first.', type: 'text' as const }],
          isError: true,
        }
      }

      // Check connection state before making request
      const state = client.getState()
      if (state !== 'connected') {
        return {
          content: [{ text: `Error: Socket not connected. Current state: ${state}. Ensure "brv" is running.`, type: 'text' as const }],
          isError: true,
        }
      }

      try {
        const taskId = randomUUID()

        // Create task via transport (same pattern as brv curate command)
        // Use provided context, or empty string for file-only mode
        const resolvedContent = context?.trim() ? context : ''
        await client.request('task:create', {
          clientCwd: getWorkingDirectory(),
          content: resolvedContent,
          taskId,
          type: 'curate',
          ...(files?.length ? { files } : {}),
        })

        // Fire-and-forget: return immediately after task is queued
        // Curation is processed asynchronously by the ByteRover agent
        return {
          content: [{
            text: `✓ Context queued for curation (taskId: ${taskId}). The curation will be processed asynchronously.`,
            type: 'text' as const,
          }],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ text: `Error: ${message}`, type: 'text' as const }],
          isError: true,
        }
      }
    },
  )
}
