import {Command} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import {DEFAULT_SESSION_RETENTION} from '../../agent/core/domain/session/session-metadata.js'
import {SessionMetadataStore} from '../../agent/infra/session/session-metadata-store.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {getProcessManager} from '../../infra/process/index.js'
import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {FileOnboardingPreferenceStore} from '../../infra/storage/file-onboarding-preference-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {startRepl} from '../../tui/repl-startup.js'
import {initSessionLog, processManagerLog} from '../../utils/process-logger.js'

/**
 * Main command - Entry point for ByteRover CLI.
 *
 * Architecture v0.5.0:
 * - Main Process: Spawns Transport and Agent processes
 * - TUI discovers Transport via TransportClientFactory (same as external CLIs)
 * - All task communication via Socket.IO (NO IPC)
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

    // Start Transport and Agent processes (v0.5.0 architecture)
    // Pass session ID to Agent via environment variable
    const processManager = getProcessManager()
    await processManager.start({sessionId})

    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
    const onboardingPreferenceStore = new FileOnboardingPreferenceStore()

    // Start the interactive REPL
    // TUI will discover Transport via TransportClientFactory (same as external CLIs)
    try {
      await startRepl({
        onboardingPreferenceStore,
        projectConfigStore: new ProjectConfigStore(),
        tokenStore,
        trackingService,
        version: this.config.version,
      })
    } finally {
      await processManager.stop()
    }
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
