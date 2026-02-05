import {Command} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import {DEFAULT_SESSION_RETENTION} from '../../agent/core/domain/session/session-metadata.js'
import {SessionMetadataStore} from '../../agent/infra/session/session-metadata-store.js'
import {ProjectConfigStore} from '../../server/infra/config/file-config-store.js'
import {ConnectorManager} from '../../server/infra/connectors/connector-manager.js'
import {RuleTemplateService} from '../../server/infra/connectors/shared/template-service.js'
import {FsFileService} from '../../server/infra/file/fs-file-service.js'
import {getProcessManager} from '../../server/infra/process/index.js'
import {FileGlobalConfigStore} from '../../server/infra/storage/file-global-config-store.js'
import {FileOnboardingPreferenceStore} from '../../server/infra/storage/file-onboarding-preference-store.js'
import {createTokenStore} from '../../server/infra/storage/token-store.js'
import {FsTemplateLoader} from '../../server/infra/template/fs-template-loader.js'
import {MixpanelTrackingService} from '../../server/infra/tracking/mixpanel-tracking-service.js'
import {initSessionLog, processManagerLog} from '../../server/utils/process-logger.js'
import {startRepl} from '../../tui/repl-startup.js'

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

    // Create ConnectorManager for orphaned connector migration at REPL startup
    const fileService = new FsFileService()
    const templateLoader = new FsTemplateLoader(fileService)
    const templateService = new RuleTemplateService(templateLoader)
    const connectorManager = new ConnectorManager({
      fileService,
      projectRoot: process.cwd(),
      templateService,
    })

    // Start the interactive REPL
    // TUI will discover Transport via TransportClientFactory (same as external CLIs)
    try {
      await startRepl({
        connectorManager,
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
