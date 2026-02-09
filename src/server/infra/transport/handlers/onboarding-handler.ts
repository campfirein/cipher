import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {ISpaceService} from '../../../core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../core/interfaces/services/i-team-service.js'
import type {ITrackingService} from '../../../core/interfaces/services/i-tracking-service.js'
import type {IUserService} from '../../../core/interfaces/services/i-user-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'
import type {ProjectPathResolver} from './handler-types.js'

import {
  type OnboardingAutoSetupResponse,
  type OnboardingCompleteRequest,
  type OnboardingCompleteResponse,
  OnboardingEvents,
  type OnboardingGetStateResponse,
} from '../../../../shared/transport/events/onboarding-events.js'
import {BrvConfig} from '../../../core/domain/entities/brv-config.js'
import {syncConfigToXdg} from '../../../utils/config-xdg-sync.js'
import {getErrorMessage} from '../../../utils/error-helpers.js'

export interface OnboardingHandlerDeps {
  projectConfigStore: IProjectConfigStore
  resolveProjectPath: ProjectPathResolver
  spaceService: ISpaceService
  teamService: ITeamService
  tokenStore: ITokenStore
  trackingService: ITrackingService
  transport: ITransportServer
  userService: IUserService
}

/**
 * Handles onboarding:* events.
 * Business logic for onboarding flow — no terminal/UI calls.
 */
export class OnboardingHandler {
  private readonly projectConfigStore: IProjectConfigStore
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly spaceService: ISpaceService
  private readonly teamService: ITeamService
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService
  private readonly transport: ITransportServer
  private readonly userService: IUserService

  constructor(deps: OnboardingHandlerDeps) {
    this.projectConfigStore = deps.projectConfigStore
    this.resolveProjectPath = deps.resolveProjectPath
    this.spaceService = deps.spaceService
    this.teamService = deps.teamService
    this.tokenStore = deps.tokenStore
    this.trackingService = deps.trackingService
    this.transport = deps.transport
    this.userService = deps.userService
  }

  setup(): void {
    this.setupGetState()
    this.setupAutoSetup()
    this.setupComplete()
  }

  private resolveEffectivePath(clientId: string): string {
    return this.resolveProjectPath(clientId) ?? process.cwd()
  }

  private setupAutoSetup(): void {
    this.transport.onRequest<void, OnboardingAutoSetupResponse>(
      OnboardingEvents.AUTO_SETUP,
      async (_data, clientId) => {
        try {
          const projectPath = this.resolveEffectivePath(clientId)

          const token = await this.tokenStore.load()
          if (!token || !token.isValid()) {
            return {error: 'Not authenticated', success: false}
          }

          // Find default team
          const {teams} = await this.teamService.getTeams(token.sessionKey, {fetchAll: true})
          const defaultTeam = teams.find((t) => t.isDefault)
          if (!defaultTeam) {
            return {error: 'No default team found', success: false}
          }

          // Find default space
          const {spaces} = await this.spaceService.getSpaces(token.sessionKey, defaultTeam.id, {fetchAll: true})
          const defaultSpace = spaces.find((s) => s.isDefault)
          if (!defaultSpace) {
            return {error: 'No default space found', success: false}
          }

          // Create partial config and write it
          const brvConfig = BrvConfig.partialFromSpace({space: defaultSpace})
          await this.projectConfigStore.write(brvConfig, projectPath)
          await syncConfigToXdg(brvConfig, projectPath)

          return {success: true}
        } catch (error) {
          return {error: getErrorMessage(error), success: false}
        }
      },
    )
  }

  private setupComplete(): void {
    this.transport.onRequest<OnboardingCompleteRequest, OnboardingCompleteResponse>(
      OnboardingEvents.COMPLETE,
      async (data) => {
        try {
          const token = await this.tokenStore.load()
          if (!token || !token.isValid()) {
            return {success: false}
          }

          // Mark user as onboarded on the server
          await this.userService.updateCurrentUser(token.sessionKey, {hasOnboardedCli: true})

          const eventName = data?.skipped ? 'onboarding:skipped' : 'onboarding:completed'
          await this.trackingService.track(eventName)

          return {success: true}
        } catch {
          return {success: false}
        }
      },
    )
  }

  private setupGetState(): void {
    this.transport.onRequest<void, OnboardingGetStateResponse>(OnboardingEvents.GET_STATE, async (_data, clientId) => {
      try {
        const projectPath = this.resolveEffectivePath(clientId)

        const token = await this.tokenStore.load()
        if (!token || !token.isValid()) {
          return {hasDefaultTeamSpace: false, hasOnboardedCli: false}
        }

        const user = await this.userService.getCurrentUser(token.sessionKey)
        const configExists = await this.projectConfigStore.exists(projectPath)

        return {
          hasDefaultTeamSpace: configExists,
          hasOnboardedCli: user.hasOnboardedCli,
        }
      } catch {
        return {hasDefaultTeamSpace: false, hasOnboardedCli: false}
      }
    })
  }
}
