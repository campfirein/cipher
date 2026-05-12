import type {DoctorDiagnostic} from '../../../shared/transport/events/channel-events.js'
import type {
  AgentDriverProfile,
  AgentDriverProfileInvocation,
} from '../../../shared/types/channel.js'
import type {IAcpDriver} from '../../core/interfaces/channel/i-acp-driver.js'
import type {IDriverProfileStore} from '../../core/interfaces/channel/i-driver-profile-store.js'

import {AcpSessionFailedError} from '../../core/domain/channel/errors.js'
import {advertisedCapabilities, classifyDriver} from './driver-class-classifier.js'

/**
 * Phase-3 onboarding service (Slice 3.2).
 *
 * Probe a candidate ACP agent end-to-end:
 *   1. `driver.start()` — runs `initialize`. A handshake failure throws
 *      AcpHandshakeFailedError (from the driver) and propagates upward;
 *      `stop()` is always invoked in finally.
 *   2. `driver.probeSession()` — issues `session/new`. If `false`, the
 *      classifier downgrades to `C-prime`. We also surface an error-level
 *      DoctorDiagnostic AND throw AcpSessionFailedError so the caller's
 *      CLI exits non-zero — Phase-3 spec edit §11 makes this an error code.
 *   3. Classify via {@link classifyDriver}.
 *   4. Persist the AgentDriverProfile via {@link IDriverProfileStore}.
 *
 * On any failure the profile is NOT persisted and the driver is stopped.
 * Successful onboards return `{profile, diagnostics}` so the CLI can echo
 * any non-error advisories (e.g. capability surface notes).
 */

export type OnboardArgs = {
  readonly displayName: string
  readonly invocation: AgentDriverProfileInvocation
  readonly profileName: string
}

export type OnboardResult = {
  readonly diagnostics: DoctorDiagnostic[]
  readonly profile: AgentDriverProfile
}

export type ChannelOnboardServiceDeps = {
  readonly clock: () => Date
  readonly driverFactory: (invocation: AgentDriverProfileInvocation, handle: string) => IAcpDriver
  readonly store: IDriverProfileStore
}

export interface IChannelOnboardService {
  onboard(args: OnboardArgs): Promise<OnboardResult>
}

export class ChannelOnboardService implements IChannelOnboardService {
  private readonly deps: ChannelOnboardServiceDeps

  public constructor(deps: ChannelOnboardServiceDeps) {
    this.deps = deps
  }

  async onboard(args: OnboardArgs): Promise<OnboardResult> {
    const diagnostics: DoctorDiagnostic[] = []
    // The handle used to satisfy the driverFactory contract; the onboarding
    // probe does not register against a channel, so we synthesise one.
    const handle = `@${args.profileName}`
    const driver = this.deps.driverFactory(args.invocation, handle)
    try {
      await driver.start()
      diagnostics.push({code: 'ONBOARD_INITIALIZE_OK', message: 'ACP initialize handshake succeeded', severity: 'info'})

      const sessionNewSucceeded = await driver.probeSession()
      if (!sessionNewSucceeded) {
        diagnostics.push({
          code: 'ONBOARD_SESSION_NEW_FAILED',
          details: {profileName: args.profileName},
          message: 'ACP session/new probe failed — agent classified as C-prime and onboarding refused',
          severity: 'error',
        })
        throw new AcpSessionFailedError(
          `session/new probe failed for ${args.profileName}; onboarding refused.`,
        )
      }

      const snapshot = driver.acpInitialize ?? {}
      const driverClass = classifyDriver({
        _meta: snapshot._meta,
        agentCapabilities: snapshot.agentCapabilities,
        sessionNewSucceeded,
      })
      const capabilities = advertisedCapabilities({
        agentCapabilities: snapshot.agentCapabilities,
        sessionNewSucceeded,
      })

      const profile: AgentDriverProfile = {
        capabilities,
        detectedAcpVersion:
          driver.protocolVersion === undefined ? undefined : String(driver.protocolVersion),
        displayName: args.displayName,
        driverClass,
        invocation: args.invocation,
        name: args.profileName,
        probedAt: this.deps.clock().toISOString(),
      }
      await this.deps.store.upsert(profile)
      diagnostics.push({
        code: 'ONBOARD_CLASSIFIED',
        details: {capabilities, driverClass},
        message: `Driver classified as ${driverClass}`,
        severity: 'info',
      })

      return {diagnostics, profile}
    } finally {
      await driver.stop().catch(() => {})
    }
  }
}
