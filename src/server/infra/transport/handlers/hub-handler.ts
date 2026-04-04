import {existsSync, rmSync} from 'node:fs'
import {join} from 'node:path'

import type {AuthScheme} from '../../../../shared/transport/types/auth-scheme.js'
import type {HubEntryDTO} from '../../../../shared/transport/types/dto.js'
import type {HubInstallAuthParams, IHubInstallService} from '../../../core/interfaces/hub/i-hub-install-service.js'
import type {IHubKeychainStore} from '../../../core/interfaces/hub/i-hub-keychain-store.js'
import type {IHubRegistryConfigStore} from '../../../core/interfaces/hub/i-hub-registry-config-store.js'
import type {IHubRegistryService} from '../../../core/interfaces/hub/i-hub-registry-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  HubEvents,
  type HubInstallAllResponse,
  type HubInstallRequest,
  type HubInstallResponse,
  type HubListResponse,
  type HubRegistryAddRequest,
  type HubRegistryAddResponse,
  type HubRegistryDTO,
  type HubRegistryListResponse,
  type HubRegistryRemoveRequest,
  type HubRegistryRemoveResponse,
  type HubUninstallRequest,
  type HubUninstallResponse,
} from '../../../../shared/transport/events/hub-events.js'
import {BRV_DIR, BUNDLES_DIR, CONTEXT_TREE_DIR} from '../../../constants.js'
import {type Agent, isAgent} from '../../../core/domain/entities/agent.js'
import {loadDependenciesFile, writeDependenciesFile} from '../../../core/domain/knowledge/dependencies-schema.js'
import {CompositeHubRegistryService} from '../../hub/composite-hub-registry-service.js'
import {HubRegistryService} from '../../hub/hub-registry-service.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

const OFFICIAL_REGISTRY_NAME = 'official'

const RESERVED_REGISTRY_NAMES = new Set(['brv', 'byterover', 'campfire', 'campfirein', 'official'])

export interface HubHandlerDeps {
  hubInstallService: IHubInstallService
  hubKeychainStore: IHubKeychainStore
  hubRegistryConfigStore: IHubRegistryConfigStore
  officialRegistryUrl: string
  registryTimeoutMs?: number
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

export class HubHandler {
  private readonly hubInstallService: IHubInstallService
  private readonly hubKeychainStore: IHubKeychainStore
  private readonly hubRegistryConfigStore: IHubRegistryConfigStore
  private hubRegistryService: IHubRegistryService
  private readonly officialRegistryUrl: string
  private readonly registryTimeoutMs?: number
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: HubHandlerDeps) {
    this.hubInstallService = deps.hubInstallService
    this.hubKeychainStore = deps.hubKeychainStore
    this.hubRegistryConfigStore = deps.hubRegistryConfigStore
    this.officialRegistryUrl = deps.officialRegistryUrl
    this.registryTimeoutMs = deps.registryTimeoutMs
    this.resolveProjectPath = deps.resolveProjectPath
    this.transport = deps.transport
    // Will be built during setup
    this.hubRegistryService = new HubRegistryService({
      name: OFFICIAL_REGISTRY_NAME,
      timeoutMs: this.registryTimeoutMs,
      url: deps.officialRegistryUrl,
    })
  }

  async setup(): Promise<void> {
    await this.rebuildRegistryService()

    this.transport.onRequest<void, HubListResponse>(HubEvents.LIST, () => this.handleList())

    this.transport.onRequest<HubInstallRequest, HubInstallResponse>(HubEvents.INSTALL, (data, clientId) =>
      this.handleInstall(data, clientId),
    )

    this.transport.onRequest<HubRegistryAddRequest, HubRegistryAddResponse>(HubEvents.REGISTRY_ADD, (data) =>
      this.handleRegistryAdd(data),
    )

    this.transport.onRequest<HubRegistryRemoveRequest, HubRegistryRemoveResponse>(HubEvents.REGISTRY_REMOVE, (data) =>
      this.handleRegistryRemove(data),
    )

    this.transport.onRequest<void, HubRegistryListResponse>(HubEvents.REGISTRY_LIST, () => this.handleRegistryList())

    this.transport.onRequest<void, HubInstallAllResponse>(HubEvents.INSTALL_ALL, (_data, clientId) =>
      this.handleInstallAll(clientId),
    )

    this.transport.onRequest<HubUninstallRequest, HubUninstallResponse>(HubEvents.UNINSTALL, (data, clientId) =>
      this.handleUninstall(data, clientId),
    )
  }

  private async handleInstall(data: HubInstallRequest, clientId: string): Promise<HubInstallResponse> {
    const agent = data.agent && isAgent(data.agent) ? data.agent : undefined
    if (data.agent && !agent) {
      return {installedFiles: [], installedPath: '', message: `Invalid agent: ${data.agent}`, success: false}
    }

    const projectPath = this.resolveEffectivePath(clientId)
    const scope = data.scope ?? 'project'

    const matches = await this.hubRegistryService.getEntriesById(data.entryId).then((entries) => {
      // If a specific registry is requested, filter to that registry
      if (data.registry) {
        return entries.filter((entry) => entry.registry === data.registry)
      }

      return entries
    })

    switch (matches.length) {
      case 0: {
        return {installedFiles: [], installedPath: '', message: `Entry not found: ${data.entryId}`, success: false}
      }

      case 1: {
        // Single match: proceed with install
        return this.performInstall(matches[0], projectPath, agent, scope)
      }

      default: {
        // Multiple matches: detect duplicates
        const registryNames = matches.map((m) => m.registry ?? 'unknown').join(', ')
        return {
          installedFiles: [],
          installedPath: '',
          message: `'${data.entryId}' exists in multiple registries: ${registryNames}. Specify one with --registry <name>.`,
          success: false,
        }
      }
    }
  }

  private async handleInstallAll(clientId: string): Promise<HubInstallAllResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    const deps = loadDependenciesFile(projectPath)
    if (!deps || Object.keys(deps).length === 0) {
      return {message: 'No dependencies declared. Nothing to install.', results: [], success: true}
    }

    const entries = Object.keys(deps)

    // Partition into already-installed and to-install
    const toInstall: string[] = []
    const skipped: string[] = []
    for (const id of entries) {
      const bundleDir = join(projectPath, BRV_DIR, CONTEXT_TREE_DIR, BUNDLES_DIR, id)
      if (existsSync(bundleDir)) {
        skipped.push(id)
      } else {
        toInstall.push(id)
      }
    }

    // Build results — include skipped as already-installed entries
    const results: HubInstallAllResponse['results'] = skipped.map((entryId) => ({
      entryId,
      message: 'Already installed',
      success: true,
    }))

    if (toInstall.length > 0) {
      const settled = await Promise.allSettled(
        toInstall.map(async (entryId) => {
          const installResult = await this.handleInstall({entryId}, clientId)
          return {entryId, message: installResult.message, success: installResult.success}
        }),
      )

      for (const [i, s] of settled.entries()) {
        results.push(
          s.status === 'fulfilled'
            ? s.value
            : {
                entryId: toInstall[i],
                message: s.reason instanceof Error ? s.reason.message : 'Unknown error',
                success: false,
              },
        )
      }
    }

    const installed = results.filter((r) => r.success && r.message !== 'Already installed').length
    const allSuccess = results.every((r) => r.success)
    const summary =
      toInstall.length === 0
        ? `All ${entries.length} dependencies already installed.`
        : `Installed ${installed}/${toInstall.length} new (${skipped.length} already installed).`

    return {
      message: summary,
      results,
      success: allSuccess,
    }
  }

  private async handleList(): Promise<HubListResponse> {
    this.transport.broadcast(HubEvents.LIST_PROGRESS, {message: 'Fetching hub entries...', step: 'fetching'})
    const {entries, version} = await this.hubRegistryService.getEntries()
    return {entries, version}
  }

  private async handleRegistryAdd(data: HubRegistryAddRequest): Promise<HubRegistryAddResponse> {
    try {
      if (RESERVED_REGISTRY_NAMES.has(data.name.toLowerCase())) {
        return {message: `Registry name '${data.name}' is reserved`, success: false}
      }

      // Validate registry is reachable and returns valid data before persisting
      this.transport.broadcast(HubEvents.REGISTRY_ADD_PROGRESS, {message: 'Validating registry...', step: 'validating'})
      const probeService = new HubRegistryService({
        authScheme: data.authScheme,
        authToken: data.token,
        headerName: data.headerName,
        name: data.name,
        timeoutMs: this.registryTimeoutMs,
        url: data.url,
      })
      await probeService.getEntries()

      this.transport.broadcast(HubEvents.REGISTRY_ADD_PROGRESS, {message: 'Saving registry...', step: 'saving'})
      await this.hubRegistryConfigStore.addRegistry({
        ...(data.authScheme ? {authScheme: data.authScheme} : {}),
        ...(data.headerName ? {headerName: data.headerName} : {}),
        name: data.name,
        url: data.url,
      })

      if (data.token) {
        await this.hubKeychainStore.setToken(data.name, data.token)
      }

      await this.rebuildRegistryService()

      return {message: `Registry '${data.name}' added successfully`, success: true}
    } catch (error) {
      return {
        message: `Failed to add registry: ${error instanceof Error ? error.message : 'Unknown error'}`,
        success: false,
      }
    }
  }

  private async handleRegistryList(): Promise<HubRegistryListResponse> {
    this.transport.broadcast(HubEvents.REGISTRY_LIST_PROGRESS, {message: 'Checking registries...', step: 'checking'})
    const registries = await this.hubRegistryConfigStore.getRegistries()

    const allConfigs = [
      {authScheme: 'none' as const, hasToken: false, name: OFFICIAL_REGISTRY_NAME, url: this.officialRegistryUrl},
      ...(await Promise.all(
        registries.map(async (r) => ({
          authScheme: (r.authScheme ?? 'bearer') as AuthScheme,
          hasToken: (await this.hubKeychainStore.getToken(r.name)) !== undefined,
          name: r.name,
          url: r.url,
        })),
      )),
    ]

    const results = await Promise.all(
      allConfigs.map(async (config): Promise<HubRegistryDTO> => {
        try {
          const authToken = await this.hubKeychainStore.getToken(config.name)
          const probe = new HubRegistryService({
            authScheme: config.authScheme,
            authToken,
            name: config.name,
            timeoutMs: this.registryTimeoutMs,
            url: config.url,
          })
          const {entries} = await probe.getEntries()
          return {...config, entryCount: entries.length, status: 'ok'}
        } catch (error) {
          return {
            ...config,
            entryCount: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
            status: 'error',
          }
        }
      }),
    )

    return {registries: results}
  }

  private async handleRegistryRemove(data: HubRegistryRemoveRequest): Promise<HubRegistryRemoveResponse> {
    try {
      await this.hubRegistryConfigStore.removeRegistry(data.name)
      await this.hubKeychainStore.deleteToken(data.name)

      await this.rebuildRegistryService()

      return {message: `Registry '${data.name}' removed successfully`, success: true}
    } catch (error) {
      return {
        message: `Failed to remove registry: ${error instanceof Error ? error.message : 'Unknown error'}`,
        success: false,
      }
    }
  }

  private handleUninstall(data: HubUninstallRequest, clientId: string): HubUninstallResponse {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    // Remove from dependencies.json
    const deps = loadDependenciesFile(projectPath)
    if (!deps || !(data.entryId in deps)) {
      return {message: `Dependency "${data.entryId}" not found in dependencies.json`, success: false}
    }

    delete deps[data.entryId]
    writeDependenciesFile(projectPath, deps)

    // Delete installed files from bundles/ directory
    const bundleDir = join(projectPath, BRV_DIR, CONTEXT_TREE_DIR, BUNDLES_DIR, data.entryId)
    if (existsSync(bundleDir)) {
      rmSync(bundleDir, {force: true, recursive: true})
    }

    return {message: `Uninstalled "${data.entryId}" and removed from dependencies.`, success: true}
  }

  private async performInstall(
    entry: HubEntryDTO,
    projectPath: string,
    agent?: Agent,
    scope?: 'global' | 'project',
  ): Promise<HubInstallResponse> {
    try {
      let auth: HubInstallAuthParams | undefined
      if (entry.registry && entry.registry !== OFFICIAL_REGISTRY_NAME) {
        const registries = await this.hubRegistryConfigStore.getRegistries()
        const registryConfig = registries.find((r) => r.name === entry.registry)
        const authToken = (await this.hubKeychainStore.getToken(entry.registry)) ?? undefined
        auth = {
          authScheme: registryConfig?.authScheme,
          authToken,
          headerName: registryConfig?.headerName,
        }
      }

      const result = await this.hubInstallService.install({agent, auth, entry, projectPath, scope})
      const registryLabel = entry.registry ? ` [${entry.registry}]` : ''
      return {
        installedFiles: result.installedFiles,
        installedPath: result.installedPath,
        message: `${result.message}${registryLabel}`,
        success: true,
      }
    } catch (error) {
      return {
        installedFiles: [],
        installedPath: '',
        message: `Install failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        success: false,
      }
    }
  }

  private async rebuildRegistryService(): Promise<void> {
    const officialChild = new HubRegistryService({
      name: OFFICIAL_REGISTRY_NAME,
      timeoutMs: this.registryTimeoutMs,
      url: this.officialRegistryUrl,
    })

    const registries = await this.hubRegistryConfigStore.getRegistries()
    const privateChildren = await Promise.all(
      registries.map(async (r) => {
        const authToken = (await this.hubKeychainStore.getToken(r.name)) ?? undefined
        return new HubRegistryService({
          authScheme: r.authScheme,
          authToken,
          headerName: r.headerName,
          name: r.name,
          timeoutMs: this.registryTimeoutMs,
          url: r.url,
        })
      }),
    )

    this.hubRegistryService = new CompositeHubRegistryService([officialChild, ...privateChildren])
  }

  private resolveEffectivePath(clientId: string): string {
    return this.resolveProjectPath(clientId) ?? process.cwd()
  }
}
