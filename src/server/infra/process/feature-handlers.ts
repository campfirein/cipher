/**
 * Feature Handlers Setup
 *
 * Registers all feature handlers (auth, init, status, etc.) on the transport server.
 * These handlers implement the TUI ↔ Server event contract.
 */

import type {IConnectorManager} from '../../core/interfaces/connectors/i-connector-manager.js'
import type {IProviderConfigStore} from '../../core/interfaces/i-provider-config-store.js'
import type {IProviderKeychainStore} from '../../core/interfaces/i-provider-keychain-store.js'
import type {IAuthStateStore} from '../../core/interfaces/state/i-auth-state-store.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'
import type {ProjectBroadcaster, ProjectPathResolver} from '../transport/handlers/handler-types.js'

import {getAuthConfig} from '../../config/auth.config.js'
import {getCurrentConfig} from '../../config/environment.js'
import {OAuthService} from '../auth/oauth-service.js'
import {OidcDiscoveryService} from '../auth/oidc-discovery-service.js'
import {SystemBrowserLauncher} from '../browser/system-browser-launcher.js'
import {HttpCogitPullService} from '../cogit/http-cogit-pull-service.js'
import {HttpCogitPushService} from '../cogit/http-cogit-push-service.js'
import {ProjectConfigStore} from '../config/file-config-store.js'
import {ConnectorManager} from '../connectors/connector-manager.js'
import {RuleTemplateService} from '../connectors/shared/template-service.js'
import {FileContextFileReader} from '../context-tree/file-context-file-reader.js'
import {FileContextTreeService} from '../context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeWriterService} from '../context-tree/file-context-tree-writer-service.js'
import {FsFileService} from '../file/fs-file-service.js'
import {CallbackHandler} from '../http/callback-handler.js'
import {HttpSpaceService} from '../space/http-space-service.js'
import {createTokenStore} from '../storage/token-store.js'
import {HttpTeamService} from '../team/http-team-service.js'
import {FsTemplateLoader} from '../template/fs-template-loader.js'
import {
  AuthHandler,
  ConfigHandler,
  ConnectorsHandler,
  InitHandler,
  ModelHandler,
  ProviderHandler,
  PullHandler,
  PushHandler,
  ResetHandler,
  SpaceHandler,
  StatusHandler,
} from '../transport/handlers/index.js'
import {HttpUserService} from '../user/http-user-service.js'

export interface FeatureHandlersOptions {
  authStateStore: IAuthStateStore
  broadcastToProject: ProjectBroadcaster
  log: (msg: string) => void
  providerConfigStore: IProviderConfigStore
  providerKeychainStore: IProviderKeychainStore
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

/**
 * Setup all feature handlers on the transport server.
 * These handlers implement the TUI ↔ Server event contract (auth:*, config:*, status:*, etc.).
 */
export async function setupFeatureHandlers({
  authStateStore,
  broadcastToProject,
  log,
  providerConfigStore,
  providerKeychainStore,
  resolveProjectPath,
  transport,
}: FeatureHandlersOptions): Promise<void> {
  const envConfig = getCurrentConfig()
  const tokenStore = createTokenStore()
  const projectConfigStore = new ProjectConfigStore()
  const userService = new HttpUserService({apiBaseUrl: envConfig.apiBaseUrl})
  const teamService = new HttpTeamService({apiBaseUrl: envConfig.apiBaseUrl})
  const spaceService = new HttpSpaceService({apiBaseUrl: envConfig.apiBaseUrl})

  // Auth handler requires async OIDC discovery
  const discoveryService = new OidcDiscoveryService()
  const authConfig = await getAuthConfig(discoveryService)

  // Global handlers (no project context needed)
  new ConfigHandler({transport}).setup()

  new AuthHandler({
    authService: new OAuthService(authConfig),
    authStateStore,
    browserLauncher: new SystemBrowserLauncher(),
    callbackHandler: new CallbackHandler(),
    projectConfigStore,
    resolveProjectPath,
    tokenStore,
    transport,
    userService,
  }).setup()

  new ProviderHandler({
    providerConfigStore,
    providerKeychainStore,
    transport,
  }).setup()

  new ModelHandler({
    providerConfigStore,
    providerKeychainStore,
    transport,
  }).setup()

  // Shared services for project-scoped handlers
  const contextTreeService = new FileContextTreeService()
  const contextTreeSnapshotService = new FileContextTreeSnapshotService()
  const contextTreeWriterService = new FileContextTreeWriterService({snapshotService: contextTreeSnapshotService})
  const contextFileReader = new FileContextFileReader()
  const cogitPushService = new HttpCogitPushService({apiBaseUrl: envConfig.cogitApiBaseUrl})
  const cogitPullService = new HttpCogitPullService({apiBaseUrl: envConfig.cogitApiBaseUrl})

  // ConnectorManager factory — creates per-project instances since constructor binds to projectRoot
  const fileService = new FsFileService()
  const templateLoader = new FsTemplateLoader(fileService)
  const templateService = new RuleTemplateService(templateLoader)
  const connectorManagerFactory = (projectRoot: string): IConnectorManager =>
    new ConnectorManager({fileService, projectRoot, templateService})

  // Project-scoped handlers (receive resolveProjectPath for client → project resolution)
  new StatusHandler({
    contextTreeService,
    contextTreeSnapshotService,
    projectConfigStore,
    resolveProjectPath,
    tokenStore,
    transport,
  }).setup()

  new PushHandler({
    broadcastToProject,
    cogitPushService,
    contextFileReader,
    contextTreeSnapshotService,
    projectConfigStore,
    resolveProjectPath,
    tokenStore,
    transport,
  }).setup()

  new PullHandler({
    broadcastToProject,
    cogitPullService,
    contextTreeSnapshotService,
    contextTreeWriterService,
    projectConfigStore,
    resolveProjectPath,
    tokenStore,
    transport,
  }).setup()

  new ResetHandler({
    contextTreeService,
    contextTreeSnapshotService,
    resolveProjectPath,
    transport,
  }).setup()

  new SpaceHandler({
    projectConfigStore,
    resolveProjectPath,
    spaceService,
    teamService,
    tokenStore,
    transport,
  }).setup()

  new ConnectorsHandler({
    connectorManagerFactory,
    resolveProjectPath,
    transport,
  }).setup()

  new InitHandler({
    broadcastToProject,
    cogitPullService,
    connectorManagerFactory,
    contextTreeService,
    contextTreeSnapshotService,
    contextTreeWriterService,
    projectConfigStore,
    resolveProjectPath,
    spaceService,
    teamService,
    tokenStore,
    transport,
  }).setup()

  log('Feature handlers registered')
}
