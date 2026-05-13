#!/usr/bin/env node
// @brv/channel-mcp — MCP server exposing brv channel tools over stdio.
//
// Host config:
//   Claude Code  ~/.claude/mcp.json     (JSON)
//   Codex CLI    ~/.codex/config.toml   (TOML)
//   kimi-cli, opencode, Pi              (host-specific MCP configs)
//
// In all cases the host points at this file via `node /abs/path/to/.../dist/server.js`.

import {ChannelClientError} from '@brv/channel-client'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import process from 'node:process'
import type {ZodRawShape} from 'zod'

import {closeSharedClient, getSharedClient} from './connection.js'
import * as doctorTool from './tools/doctor.js'
import * as listTool from './tools/list.js'
import * as mentionTool from './tools/mention.js'
import * as showTool from './tools/show.js'

type ToolModule = {
  readonly NAME: string
  readonly DESCRIPTION: string
  readonly inputSchema: ZodRawShape
  readonly handler: (input: never, deps: {readonly client: never}) => Promise<unknown>
}

const TOOLS: readonly ToolModule[] = [
  listTool as unknown as ToolModule,
  mentionTool as unknown as ToolModule,
  showTool as unknown as ToolModule,
  doctorTool as unknown as ToolModule,
]

type TextContent = {type: 'text'; text: string}
type ToolResult = {content: TextContent[]; isError?: boolean}

const buildErrorContent = (error: unknown): ToolResult => {
  if (error instanceof ChannelClientError) {
    return {
      content: [
        {
          text: JSON.stringify({code: error.code, details: error.details, message: error.message}),
          type: 'text',
        },
      ],
      isError: true,
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{text: JSON.stringify({code: 'INTERNAL_ERROR', message}), type: 'text'}],
    isError: true,
  }
}

const buildSuccessContent = (value: unknown): ToolResult => ({
  content: [{text: JSON.stringify(value, undefined, 2), type: 'text'}],
})

export const startServer = async (): Promise<void> => {
  const server = new McpServer({
    name: '@brv/channel-mcp',
    version: '0.1.0',
  })

  for (const tool of TOOLS) {
    server.registerTool(
      tool.NAME,
      {
        description: tool.DESCRIPTION,
        inputSchema: tool.inputSchema,
      },
      async (input: unknown, _extra: unknown) => {
        try {
          const client = await getSharedClient()
          const result = await tool.handler(input as never, {client} as {readonly client: never})
          return buildSuccessContent(result)
        } catch (error) {
          return buildErrorContent(error)
        }
      },
    )
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

const onShutdown = async (signal: NodeJS.Signals): Promise<void> => {
  try {
    await closeSharedClient()
  } finally {
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('server.js')) {
  process.on('SIGINT', (s) => {
    onShutdown(s).catch(() => process.exit(1))
  })
  process.on('SIGTERM', (s) => {
    onShutdown(s).catch(() => process.exit(1))
  })
  startServer().catch((error) => {
    process.stderr.write(`[brv-channel-mcp] fatal: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
