import type {IHubInstallService} from '../../../core/interfaces/hub/i-hub-install-service.js'
import type {IHubRegistryService} from '../../../core/interfaces/hub/i-hub-registry-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'
import type {ProjectPathResolver} from './handler-types.js'

import {
  HubEvents,
  type HubInstallRequest,
  type HubInstallResponse,
  type HubListResponse,
} from '../../../../shared/transport/events/hub-events.js'

export interface HubHandlerDeps {
  hubInstallService: IHubInstallService
  hubRegistryService: IHubRegistryService
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

export class HubHandler {
  private readonly hubInstallService: IHubInstallService
  private readonly hubRegistryService: IHubRegistryService
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: HubHandlerDeps) {
    this.hubInstallService = deps.hubInstallService
    this.hubRegistryService = deps.hubRegistryService
    this.resolveProjectPath = deps.resolveProjectPath
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, HubListResponse>(HubEvents.LIST, () => this.handleList())

    this.transport.onRequest<HubInstallRequest, HubInstallResponse>(HubEvents.INSTALL, (data, clientId) =>
      this.handleInstall(data, clientId),
    )
  }

  private async handleInstall(data: HubInstallRequest, clientId: string): Promise<HubInstallResponse> {
    const projectPath = this.resolveEffectivePath(clientId)

    const entry = await this.hubRegistryService.getEntryById(data.entryId)
    if (!entry) {
      return {installedFiles: [], message: `Entry not found: ${data.entryId}`, success: false}
    }

    try {
      const result = await this.hubInstallService.install(entry, projectPath, data.agent)
      return {installedFiles: result.installedFiles, message: result.message, success: true}
    } catch (error) {
      return {
        installedFiles: [],
        message: `Install failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        success: false,
      }
    }
  }

  private async handleList(): Promise<HubListResponse> {
    const {entries, version} = await this.hubRegistryService.getEntries()
    return {entries, version}
  }

  private resolveEffectivePath(clientId: string): string {
    return this.resolveProjectPath(clientId) ?? process.cwd()
  }
}
