/**
 * Feature Handlers Setup
 *
 * Registers all feature handlers (auth, init, status, etc.) on the transport server.
 * These handlers implement the TUI ↔ Server event contract.
 */

import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

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
import {FileGlobalConfigStore} from '../storage/file-global-config-store.js'
import {FileProviderConfigStore} from '../storage/file-provider-config-store.js'
import {ProviderKeychainStore} from '../storage/provider-keychain-store.js'
import {createTokenStore} from '../storage/token-store.js'
import {HttpTeamService} from '../team/http-team-service.js'
import {FsTemplateLoader} from '../template/fs-template-loader.js'
import {MixpanelTrackingService} from '../tracking/mixpanel-tracking-service.js'
import {
  AuthHandler,
  ConfigHandler,
  ConnectorsHandler,
  InitHandler,
  ModelHandler,
  OnboardingHandler,
  ProviderHandler,
  PullHandler,
  PushHandler,
  ResetHandler,
  SpaceHandler,
  StatusHandler,
} from '../transport/handlers/index.js'
import {HttpUserService} from '../user/http-user-service.js'

export interface FeatureHandlersOptions {
  log: (msg: string) => void
  transport: ITransportServer
}

/**
 * Setup all feature handlers on the transport server.
 * These handlers implement the TUI ↔ Server event contract (auth:*, config:*, status:*, etc.).
 */
export async function setupFeatureHandlers({log, transport}: FeatureHandlersOptions): Promise<void> {
  const envConfig = getCurrentConfig()
  const tokenStore = createTokenStore()
  const globalConfigStore = new FileGlobalConfigStore()
  const projectConfigStore = new ProjectConfigStore()
  const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
  const providerConfigStore = new FileProviderConfigStore()
  const providerKeychainStore = new ProviderKeychainStore()
  const userService = new HttpUserService({apiBaseUrl: envConfig.apiBaseUrl})
  const teamService = new HttpTeamService({apiBaseUrl: envConfig.apiBaseUrl})
  const spaceService = new HttpSpaceService({apiBaseUrl: envConfig.apiBaseUrl})

  // Auth handler requires async OIDC discovery
  const discoveryService = new OidcDiscoveryService()
  const authConfig = await getAuthConfig(discoveryService)

  new ConfigHandler({transport}).setup()

  new StatusHandler({
    contextTreeService: new FileContextTreeService(),
    contextTreeSnapshotService: new FileContextTreeSnapshotService(),
    projectConfigStore,
    tokenStore,
    trackingService,
    transport,
  }).setup()

  new AuthHandler({
    authService: new OAuthService(authConfig),
    browserLauncher: new SystemBrowserLauncher(),
    callbackHandler: new CallbackHandler(),
    projectConfigStore,
    tokenStore,
    trackingService,
    transport,
    userService,
  }).setup()

  new OnboardingHandler({
    projectConfigStore,
    spaceService,
    teamService,
    tokenStore,
    trackingService,
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

  // Shared services for push/pull/reset/space/connectors/init handlers
  const contextTreeService = new FileContextTreeService()
  const contextTreeSnapshotService = new FileContextTreeSnapshotService()
  const contextTreeWriterService = new FileContextTreeWriterService({snapshotService: contextTreeSnapshotService})
  const contextFileReader = new FileContextFileReader()
  const cogitPushService = new HttpCogitPushService({apiBaseUrl: envConfig.apiBaseUrl})
  const cogitPullService = new HttpCogitPullService({apiBaseUrl: envConfig.apiBaseUrl})

  const fileService = new FsFileService()
  const templateLoader = new FsTemplateLoader(fileService)
  const templateService = new RuleTemplateService(templateLoader)
  const connectorManager = new ConnectorManager({
    fileService,
    projectRoot: process.cwd(),
    templateService,
  })

  new PushHandler({
    cogitPushService,
    contextFileReader,
    contextTreeSnapshotService,
    projectConfigStore,
    tokenStore,
    trackingService,
    transport,
  }).setup()

  new PullHandler({
    cogitPullService,
    contextTreeSnapshotService,
    contextTreeWriterService,
    projectConfigStore,
    tokenStore,
    trackingService,
    transport,
  }).setup()

  new ResetHandler({
    contextTreeService,
    contextTreeSnapshotService,
    transport,
  }).setup()

  new SpaceHandler({
    projectConfigStore,
    spaceService,
    teamService,
    tokenStore,
    transport,
  }).setup()

  new ConnectorsHandler({
    connectorManager,
    trackingService,
    transport,
  }).setup()

  new InitHandler({
    cogitPullService,
    connectorManager,
    contextTreeService,
    contextTreeSnapshotService,
    contextTreeWriterService,
    projectConfigStore,
    spaceService,
    teamService,
    tokenStore,
    trackingService,
    transport,
  }).setup()

  log('Feature handlers registered')
}
