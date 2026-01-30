/**
 * NoOp Implementations for Core Interfaces
 *
 * These are used by CoreProcess when creating UseCases for Transport mode.
 * Transport mode receives auth/config directly and doesn't use these stores,
 * so NoOp implementations are sufficient.
 */

import type {AuthToken} from '../domain/entities/auth-token.js'
import type {BrvConfig} from '../domain/entities/brv-config.js'
import type {EventName, PropertyDict} from '../domain/entities/event.js'
import type {ITokenStore} from './auth/i-token-store.js'
import type {
  ConfirmOptions,
  FileSelectorItem,
  FileSelectorOptions,
  InputOptions,
  ITerminal,
  SearchOptions,
  SelectOptions,
} from './services/i-terminal.js'
import type {ITrackingService} from './services/i-tracking-service.js'
import type {IProjectConfigStore} from './storage/i-project-config-store.js'

/**
 * NoOp Terminal - Does nothing, used for headless Transport mode.
 */
export class NoOpTerminal implements ITerminal {
  actionStart(_message: string): void {}

  actionStop(_message?: string): void {}

  async confirm(_options: ConfirmOptions): Promise<boolean> {
    return false
  }

  error(_message: string): void {}

  async fileSelector(_options: FileSelectorOptions): Promise<FileSelectorItem | null> {
    return null
  }

  async input(_options: InputOptions): Promise<string> {
    return ''
  }

  log(_message?: string): void {}

  async search<T>(_options: SearchOptions<T>): Promise<T> {
    throw new Error('NoOpTerminal: search not supported in headless mode')
  }

  async select<T>(_options: SelectOptions<T>): Promise<T> {
    throw new Error('NoOpTerminal: select not supported in headless mode')
  }

  warn(_message: string): void {}
}

/**
 * NoOp Tracking Service - Does nothing, used for headless Transport mode.
 */
export class NoOpTrackingService implements ITrackingService {
  async track(_eventName: EventName, _properties?: PropertyDict): Promise<void> {}
}

/**
 * NoOp Token Store - Always returns undefined, used when Core loads auth separately.
 * In Transport mode, auth is passed directly to UseCases.
 */
export class NoOpTokenStore implements ITokenStore {
  async clear(): Promise<void> {}

  async load(): Promise<AuthToken | undefined> {
    return undefined
  }

  async save(_token: AuthToken): Promise<void> {}
}

/**
 * NoOp Project Config Store - Always returns undefined, used when Core loads config separately.
 * In Transport mode, brvConfig is passed directly to UseCases.
 */
export class NoOpProjectConfigStore implements IProjectConfigStore {
  async exists(_directory?: string): Promise<boolean> {
    return false
  }

  async read(_directory?: string): Promise<BrvConfig | undefined> {
    return undefined
  }

  async write(_config: BrvConfig, _directory?: string): Promise<void> {}
}
