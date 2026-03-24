import {ensureDaemonRunning} from '@campfirein/brv-transport-client'
import {Command} from '@oclif/core'

import {resolveProject} from '../../server/infra/project/resolve-project.js'
import {resolveLocalServerMainPath} from '../../server/utils/server-main-resolver.js'
import {startRepl} from '../../tui/repl-startup.js'

/**
 * Main command - Entry point for ByteRover CLI.
 *
 * Ensures the global daemon is running, then starts the interactive REPL.
 * The daemon manages the transport server and agent pool (forked child processes).
 * TUI connects to the daemon via TransportClientFactory.
 */
export default class Main extends Command {
  public static description = 'ByteRover CLI - Interactive REPL'
  /**
   *  Hide from help listing since this is the default command (only 'brv')
   */
  public static hidden = true

  public async run(): Promise<void> {
    // Check if running in an interactive terminal
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.log('ByteRover REPL requires an interactive terminal.')
      this.log("Run 'brv --help' for available commands.")
      return
    }

    // Pre-flight: ensure daemon is running (spawn if needed, restart on version mismatch)
    const daemonResult = await ensureDaemonRunning({
      serverPath: resolveLocalServerMainPath(),
      version: this.config.version,
    })
    if (!daemonResult.success) {
      const detail = daemonResult.spawnError ? `: ${daemonResult.spawnError}` : ''
      this.error(
        `Failed to start daemon: timed out waiting for daemon to become ready${detail}\n\nRun 'brv restart' to force a clean restart.`,
      )
    }

    // Resolve project (workspace-link-aware) before starting TUI.
    // Gracefully handle broken/malformed workspace links so TUI still starts
    // (user can fix via /unlink from within the REPL).
    let resolution: ReturnType<typeof resolveProject> = null
    try {
      resolution = resolveProject()
    } catch {
      // Broken workspace link — start TUI without resolved project (falls back to cwd)
    }

    // Start the interactive REPL (TUI connects via connectToDaemon internally)
    await startRepl({
      projectPath: resolution?.projectRoot,
      version: this.config.version,
      workspaceRoot: resolution?.workspaceRoot,
    })

    this.exit(0)
  }
}
