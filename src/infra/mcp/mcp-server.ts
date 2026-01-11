import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import type { ITransportClient } from '../../core/interfaces/transport/index.js'

import { createTransportClientFactory } from '../transport/transport-client-factory.js'
import { registerBrvCurateTool, registerBrvQueryTool } from './tools/index.js'

export interface McpServerConfig {
  /** CLI version for MCP server identification */
  version: string
  /** Working directory for file operations */
  workingDirectory: string
}

/**
 * ByteRover MCP Server.
 *
 * Exposes brv-query and brv-curate as MCP tools for coding agents.
 * Connects to a running brv instance via Socket.IO transport.
 *
 * Architecture:
 * - Coding agent spawns `brv mcp` process
 * - MCP server connects to running brv instance via Socket.IO
 * - MCP tools create tasks via transport
 * - Tasks are executed by the existing agent process
 */
export class ByteRoverMcpServer {
  private client: ITransportClient | undefined
  private readonly config: McpServerConfig
  private readonly server: McpServer
  private transport: StdioServerTransport | undefined

  constructor(config: McpServerConfig) {
    this.config = config
    this.server = new McpServer({
      name: 'byterover',
      version: config.version,
    })

    // Register tools with lazy client getter
    // Client will be set when start() is called
    registerBrvQueryTool(this.server, () => this.client)
    registerBrvCurateTool(
      this.server,
      () => this.client,
      () => this.config.workingDirectory,
    )
  }

  /**
   * Starts the MCP server.
   *
   * 1. Connects to running brv instance via Socket.IO
   * 2. Starts MCP server with stdio transport
   *
   * @throws NoInstanceRunningError - No brv instance is running
   * @throws ConnectionFailedError - Failed to connect to brv instance
   */
  async start(): Promise<void> {
    this.log('Starting MCP server...')
    this.log(`Working directory: ${this.config.workingDirectory}`)

    // Connect to running brv instance
    const factory = createTransportClientFactory()
    this.log('Connecting to brv instance...')

    let connectionResult
    try {
      connectionResult = await factory.connect(this.config.workingDirectory)
    } catch (error) {
      this.log(`Connection failed: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }

    const {client, projectRoot} = connectionResult
    this.client = client

    this.log(`Connected to brv instance at ${projectRoot}`)
    this.log(`Client ID: ${client.getClientId()}`)
    this.log(`Initial connection state: ${client.getState()}`)

    // Monitor connection state changes
    client.onStateChange((state) => {
      const timestamp = new Date().toISOString()
      this.log(`[${timestamp}] Connection state changed: ${state}`)
      if (state === 'disconnected') {
        this.log(`[${timestamp}] Socket disconnected from brv instance. Tools will fail until reconnected.`)
        // Log stack trace to understand where disconnect is coming from
        this.log(`[${timestamp}] Stack trace: ${new Error().stack}`)
      } else if (state === 'reconnecting') {
        this.log(`[${timestamp}] Attempting to reconnect to brv instance...`)
      } else if (state === 'connected') {
        this.log(`[${timestamp}] Reconnected to brv instance.`)
      }
    })

    // Start MCP server with stdio transport
    this.transport = new StdioServerTransport()
    await this.server.connect(this.transport)

    this.log('MCP server started and ready for tool calls')

    // Log client state periodically to debug connection issues
    setInterval(() => {
      if (this.client) {
        this.log(`[heartbeat] Client state: ${this.client.getState()}, ID: ${this.client.getClientId()}`)
      } else {
        this.log('[heartbeat] Client is undefined!')
      }
    }, 10_000)
  }

  /**
   * Stops the MCP server.
   *
   * Disconnects from the brv instance.
   */
  async stop(): Promise<void> {
    if (this.client) {
      await this.client.disconnect()
      this.client = undefined
    }
  }

  /**
   * Log to stderr (stdout is reserved for MCP protocol).
   */
  private log(msg: string): void {
    process.stderr.write(`[brv-mcp] ${msg}\n`)
  }
}
