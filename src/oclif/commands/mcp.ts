import {NoInstanceRunningError} from '@campfirein/brv-transport-client'
import {Command} from '@oclif/core'
import {join} from 'node:path'

import {ByteRoverMcpServer} from '../../server/infra/mcp/index.js'
import {getGlobalDataDir} from '../../server/utils/global-data-path.js'

/**
 * MCP command - starts the MCP server for coding agent integration.
 *
 * This command is spawned by coding agents (Claude Code, Cursor, Windsurf)
 * and connects to a running brv instance via Socket.IO.
 */
export default class Mcp extends Command {
  public static description = `Start MCP server for coding agent integration

Exposes tools:
- brv-query: Query the context tree
- brv-curate: Curate context to the tree`
  public static examples = [
    '# Start MCP server (typically called by coding agents)',
    '<%= config.bin %> <%= command.id %>',
  ]
  public static hidden = true // Called by agents, not users directly

  public async run(): Promise<void> {
    // Prevent silent crashes — log to stderr so Windsurf/Cursor/Claude can surface the error
    const logError = (label: string, error: unknown): void => {
      const msg = error instanceof Error ? error.stack ?? error.message : String(error)
      process.stderr.write(`[brv-mcp] ${label}: ${msg}\n`)
    }

    process.on('uncaughtException', (error) => {
      logError('Uncaught exception', error)
    })
    process.on('unhandledRejection', (reason) => {
      logError('Unhandled rejection', reason)
    })

    try {
      const server = new ByteRoverMcpServer({
        version: this.config.version,
        workingDirectory: process.cwd(),
      })

      // Graceful shutdown
      const cleanup = async (): Promise<void> => {
        await server.stop()
        // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
        process.exit(0)
      }

      process.on('SIGTERM', cleanup)
      process.on('SIGINT', cleanup)

      await server.start()

      // Keep the process alive - MCP server runs on stdio
      // The process will be terminated by SIGTERM/SIGINT or when the parent process closes stdin
      await new Promise<void>((resolve) => {
        process.stdin.on('close', () => {
          resolve()
        })
        process.stdin.on('end', () => {
          resolve()
        })
      })

      await server.stop()
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Failed to start daemon')) {
        this.logToStderr(`Error: ${error.message}`)
        this.logToStderr(`Check daemon logs at: ${join(getGlobalDataDir(), 'logs')}`)
        this.logToStderr("Run 'brv restart' to force a clean restart.")
        // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
        process.exit(1)
      }

      if (error instanceof NoInstanceRunningError) {
        this.logToStderr('Error: Daemon was started but connection failed.')
        this.logToStderr('The daemon may have crashed immediately after starting.')
        this.logToStderr(`Check daemon logs at: ${join(getGlobalDataDir(), 'logs')}`)
        this.logToStderr("Run 'brv restart' to force a clean restart.")
        // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
        process.exit(1)
      }

      throw error
    }
  }
}
