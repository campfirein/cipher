import type {SessionInfo} from '../../../agent/core/domain/session/session-metadata.js'
import type {ISessionReader} from '../../core/interfaces/session/i-session-reader.js'

import {SessionMetadataStore} from '../../../agent/infra/session/session-metadata-store.js'

type SessionReaderOptions = {
  /** Explicit sessions directory path (XDG storage path) */
  sessionsDir: string
  /** Project working directory */
  workingDirectory: string
}

/**
 * Adapter for reading session metadata from agent's SessionMetadataStore.
 * Provides server-side access to session data without tight coupling to agent infrastructure.
 */
export class SessionReader implements ISessionReader {
  private readonly store: SessionMetadataStore

  constructor(options: SessionReaderOptions) {
    this.store = new SessionMetadataStore({
      sessionsDir: options.sessionsDir,
      workingDirectory: options.workingDirectory,
    })
  }

  async listSessions(): Promise<SessionInfo[]> {
    return this.store.listSessions()
  }
}
