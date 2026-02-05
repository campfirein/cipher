import {ensureDaemonRunning} from '@campfirein/brv-transport-client'
import {Command} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import {DEFAULT_SESSION_RETENTION} from '../../agent/core/domain/session/session-metadata.js'
import {SessionMetadataStore} from '../../agent/infra/session/session-metadata-store.js'
import {ProjectConfigStore} from '../../server/infra/config/file-config-store.js'
import {FileGlobalConfigStore} from '../../server/infra/storage/file-global-config-store.js'
import {FileOnboardingPreferenceStore} from '../../server/infra/storage/file-onboarding-preference-store.js'
import {createTokenStore} from '../../server/infra/storage/token-store.js'
import {MixpanelTrackingService} from '../../server/infra/tracking/mixpanel-tracking-service.js'
import {initSessionLog, processManagerLog} from '../../server/utils/process-logger.js'
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
    // Initialize session log (creates ~/.brv/logs/brv-{timestamp}.log)
    initSessionLog()

    // Check if running in an interactive terminal
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.log('ByteRover REPL requires an interactive terminal.')
      this.log("Run 'brv --help' for available commands.")
      return
    }

    // Resolve session ID (auto-resume or create new)
    const sessionId = await this.resolveSessionId()
    processManagerLog(`Session ID resolved: ${sessionId}`)

    // Ensure daemon is running (spawn if needed, restart on version mismatch)
    const daemonResult = await ensureDaemonRunning({serverPath: resolveLocalServerMainPath(), version: this.config.version})
    if (!daemonResult.success) {
      const detail = daemonResult.spawnError ? `: ${daemonResult.spawnError}` : ''
      this.error(`Failed to start daemon: timed out waiting for daemon to become ready${detail}`)
    }

    processManagerLog(
      `Daemon ready (pid=${daemonResult.info.pid}, port=${daemonResult.info.port}, started=${daemonResult.started})`,
    )

    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
    const onboardingPreferenceStore = new FileOnboardingPreferenceStore()

    // Start the interactive REPL
    // TUI connects to daemon via TransportClientFactory
    await startRepl({
      onboardingPreferenceStore,
      projectConfigStore: new ProjectConfigStore(),
      tokenStore,
      trackingService,
      version: this.config.version,
    })
  }

  /**
   * Resolve session ID for the agent.
   *
   * Strategy:
   * 1. Check for active session in .brv/sessions/active.json
   * 2. If active session exists and is valid (not stale), resume it
   * 3. If stale (process crashed), mark as interrupted and create new
   * 4. If no active session, create new session
   * 5. Run session cleanup on startup
   *
   * @returns Session ID to use
   */
  private async resolveSessionId(): Promise<string> {
    const sessionStore = new SessionMetadataStore()

    // Run cleanup on startup (async, don't wait)
    sessionStore.cleanupSessions(DEFAULT_SESSION_RETENTION).catch((error) => {
      processManagerLog(`Session cleanup failed: ${error}`)
    })

    // Check for active session
    const activeSession = await sessionStore.getActiveSession()

    if (activeSession) {
      // Check if the active session is stale (process not running)
      const isStale = await sessionStore.isActiveSessionStale()

      if (isStale) {
        // Mark the old session as interrupted
        processManagerLog(`Active session ${activeSession.sessionId} is stale, marking as interrupted`)
        await sessionStore.markSessionInterrupted(activeSession.sessionId)
      } else {
        // Valid active session - resume it
        processManagerLog(`Resuming active session: ${activeSession.sessionId}`)
        return activeSession.sessionId
      }
    }

    // Create new session
    const newSessionId = `agent-session-${randomUUID()}`
    processManagerLog(`Creating new session: ${newSessionId}`)

    // Save session metadata
    const metadata = sessionStore.createSessionMetadata(newSessionId)
    await sessionStore.saveSession(metadata)

    // Set as active session
    await sessionStore.setActiveSession(newSessionId)

    return newSessionId
  }
}
