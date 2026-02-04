import {connectToTransport, DaemonInstanceDiscovery, type ITransportClient} from '@campfirein/brv-transport-client'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'

import {ensureDaemonRunning} from '../daemon/daemon-spawner.js'
import {detectMcpMode, type McpMode} from './mcp-mode-detector.js'
import {registerBrvCurateTool, registerBrvQueryTool} from './tools/index.js'

export interface McpServerConfig {
  /** CLI version for MCP server identification */
  version: string
  /** Working directory for file operations */
  workingDirectory: string
}

/** Reconnection configuration */
const RECONNECT_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000
const RECONNECT_BACKOFF_MULTIPLIER = 1.5

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
  private currentReconnectDelay: number = RECONNECT_DELAY_MS
  private heartbeatInterval: NodeJS.Timeout | undefined
  private isReconnecting: boolean = false
  private readonly mode: McpMode
  private readonly projectRoot: string | undefined
  private reconnectTimer: NodeJS.Timeout | undefined
  private readonly server: McpServer
  private transport: StdioServerTransport | undefined

  constructor(config: McpServerConfig) {
    this.config = config
    const {mode, projectRoot} = detectMcpMode(config.workingDirectory)
    this.mode = mode
    this.projectRoot = projectRoot
    this.server = new McpServer({
      name: 'byterover',
      version: config.version,
    })

    // Register tools with lazy client getter
    // Client will be set when start() is called
    registerBrvQueryTool(this.server, () => this.client, () => this.getWorkingDirectory())
    registerBrvCurateTool(this.server, () => this.client, () => this.getWorkingDirectory())
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
    this.log(`Mode: ${this.mode}`)

    // Connect to running brv instance
    // Project mode: auto-registers with projectPath
    // Global mode: manually registers WITHOUT projectPath (serves multiple projects)
    this.log('Connecting to brv instance...')

    let client
    let projectRoot
    try {
      await ensureDaemonRunning()

      if (this.mode === 'project') {
        // Project mode: use default auto-registration but disable it and manually register with projectPath
        const result = await connectToTransport(this.config.workingDirectory, {
          autoRegister: false,
          discovery: new DaemonInstanceDiscovery(),
        })
        client = result.client
        projectRoot = result.projectRoot

        // Manually register with projectPath for project mode
        await client.requestWithAck('client:register', {
          clientType: 'mcp',
          projectPath: this.projectRoot,
        })
      } else {
        // Global mode: auto-register with clientType only (no projectPath)
        const result = await connectToTransport(this.config.workingDirectory, {
          clientType: 'mcp',
          discovery: new DaemonInstanceDiscovery(),
        })
        client = result.client
        projectRoot = result.projectRoot
      }
    } catch (error) {
      this.log(`Connection failed: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }

    this.client = client

    this.log(`Connected to brv instance at ${projectRoot}`)
    this.log(`Client ID: ${client.getClientId()}`)
    this.log(`Initial connection state: ${client.getState()}`)

    // Monitor connection state changes and handle reconnection
    this.setupStateChangeHandler(client)

    // Start MCP server with stdio transport
    this.transport = new StdioServerTransport()
    await this.server.connect(this.transport)

    this.log('MCP server started and ready for tool calls')

    // Log client state periodically to debug connection issues
    this.heartbeatInterval = setInterval(() => {
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
    // Clear any pending reconnection timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }

    this.isReconnecting = false

    if (this.client) {
      await this.client.disconnect()
      this.client = undefined
    }
  }

  /**
   * Attempts to reconnect to the brv instance.
   * Uses exponential backoff for retry delays.
   */
  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting) {
      this.log('Reconnection already in progress, skipping...')
      return
    }

    this.isReconnecting = true
    this.log(`Attempting to reconnect in ${this.currentReconnectDelay}ms...`)

    this.reconnectTimer = setTimeout(async () => {
      try {
        // Reconnect to daemon (auto-start if needed) with auto-registration
        await ensureDaemonRunning()
        const result = await connectToTransport(this.config.workingDirectory, {
          clientType: 'mcp',
          discovery: new DaemonInstanceDiscovery(),
        })

        // Disconnect old client if it exists
        if (this.client) {
          try {
            await this.client.disconnect()
          } catch {
            // Ignore disconnect errors on old client
          }
        }

        this.client = result.client
        this.log(`Reconnected successfully! Client ID: ${result.client.getClientId()}`)

        // Reset backoff delay on successful connection
        this.currentReconnectDelay = RECONNECT_DELAY_MS
        this.isReconnecting = false

        // Set up state change handler for the new client
        this.setupStateChangeHandler(result.client)
      } catch (error) {
        this.log(`Reconnection failed: ${error instanceof Error ? error.message : String(error)}`)

        // Increase delay with exponential backoff (capped at max)
        this.currentReconnectDelay = Math.min(
          this.currentReconnectDelay * RECONNECT_BACKOFF_MULTIPLIER,
          RECONNECT_MAX_DELAY_MS,
        )
        this.isReconnecting = false

        // Schedule next reconnection attempt
        this.attemptReconnect()
      }
    }, this.currentReconnectDelay)
  }

  /**
   * Returns the project root directory for MCP tool calls.
   *
   * In project mode, returns the discovered project root (where .brv/config.json lives).
   * In global mode, returns undefined — each tool call must provide cwd.
   */
  private getWorkingDirectory(): string | undefined {
    return this.mode === 'project' ? this.projectRoot : undefined
  }

  /**
   * Registers this MCP client with the daemon for project tracking.
   * Non-fatal: MCP server works without registration in degraded mode.
   */

  /**
   * Log to stderr (stdout is reserved for MCP protocol).
   */
  private log(msg: string): void {
    process.stderr.write(`[brv-mcp] ${msg}\n`)
  }

  /**
   * Sets up the state change handler for a client.
   * Handles disconnection by triggering auto-reconnect.
   */
  private setupStateChangeHandler(client: ITransportClient): void {
    client.onStateChange((state) => {
      const timestamp = new Date().toISOString()
      this.log(`[${timestamp}] Connection state changed: ${state}`)

      switch (state) {
        case 'connected': {
          this.log(`[${timestamp}] Connected to brv instance.`)
          // Reset backoff delay on successful connection
          this.currentReconnectDelay = RECONNECT_DELAY_MS
          this.isReconnecting = false
          break
        }

        case 'disconnected': {
          this.log(`[${timestamp}] Socket disconnected from brv instance. Initiating reconnection...`)
          // Trigger auto-reconnect
          this.attemptReconnect()
          break
        }

        case 'reconnecting': {
          this.log(`[${timestamp}] Socket.IO attempting to reconnect...`)
          break
        }
      }
    })
  }
}
