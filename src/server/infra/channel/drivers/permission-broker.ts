import type {PermissionOption, RequestPermissionRequest, RequestPermissionResponse} from '@agentclientprotocol/sdk'

import type {PendingPermission} from '../../../core/domain/channel/types.js'

import {PermissionExpiredError, UnknownPermissionRequestError} from '../../../core/domain/channel/errors.js'

/** High-level decision the transport layer accepts. The broker translates this into the SDK's per-option ID. */
export type PermissionDecision = 'allow' | 'always' | 'deny'

/**
 * Resolved decision shape returned to the driver. Contains the SDK response (which the driver
 * forwards to the ACP server) plus a `denied` flag so the driver doesn't have to inspect the
 * vendor-specific `optionId` to decide whether to throw `PermissionDeniedError`. The flag is
 * derived from `PermissionOption.kind` (the protocol-defined classifier), not the ID string.
 */
export interface ResolvedDecision {
  denied: boolean
  response: RequestPermissionResponse
}

interface ParkedRequest {
  channelId: string
  permissionRequestId: string
  reject: (error: Error) => void
  request: RequestPermissionRequest
  resolve: (decision: ResolvedDecision) => void
  timeoutHandle: NodeJS.Timeout
  turnId: string
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Parks ACP `permission/request` callbacks until either the human-side decision
 * arrives (Phase 3) or the timeout fires.
 *
 * Phase 2 review fix F4: timeout *rejects* with `PermissionExpiredError`. The
 * orchestrator catches it and transitions the turn to `expired` via the
 * existing state machine. The broker never synthesises a fake `deny` response
 * — let the rejection propagate so the ACP server learns about it cleanly.
 *
 * Phase 2 review fix Codex F3: parked requests are keyed by
 * `(channelId, turnId, permissionRequestId)`. Per-channel turn IDs (`t-001`,
 * `t-002`, …) repeat, so a turnId-only map collides across channels. The
 * compound key disambiguates concurrent parked permissions.
 *
 * Codex re-review (round 3) Finding 1: `decide()` accepts a high-level
 * `PermissionDecision` and translates it to a real `optionId` by looking up
 * the parked request's options by `kind`. Vendor adapters use arbitrary
 * IDs like `reject_once_1`; matching on `kind` (the protocol-classified
 * `'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'`) is the
 * portable way to pick the correct option.
 */
export class PermissionBroker {
  private readonly parked = new Map<string, ParkedRequest>()

  public constructor(private readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS) {}

  public decide(
    channelId: string,
    turnId: string,
    permissionRequestId: string,
    decision: PermissionDecision,
  ): ResolvedDecision {
    const key = this.key(channelId, turnId, permissionRequestId)
    const entry = this.parked.get(key)
    if (!entry) throw new UnknownPermissionRequestError(turnId)
    clearTimeout(entry.timeoutHandle)
    this.parked.delete(key)

    const option = pickOptionForDecision(entry.request.options, decision)
    const response: RequestPermissionResponse = {
      outcome: {optionId: option.optionId, outcome: 'selected'},
    }
    const resolved: ResolvedDecision = {
      denied: option.kind === 'reject_once' || option.kind === 'reject_always',
      response,
    }
    entry.resolve(resolved)
    return resolved
  }

  public listPending(channelId?: string): PendingPermission[] {
    const projection: PendingPermission[] = []
    for (const entry of this.parked.values()) {
      if (channelId && entry.channelId !== channelId) continue
      const rationale = entry.request.toolCall.title ?? undefined
      const projected: PendingPermission = {
        channelId: entry.channelId,
        permissionRequestId: entry.permissionRequestId,
        toolName: entry.request.toolCall.kind ?? 'unknown',
        turnId: entry.turnId,
      }
      if (rationale !== undefined) projected.rationale = rationale
      projection.push(projected)
    }

    return projection
  }

  public async parkAndAwait(
    turnId: string,
    channelId: string,
    request: RequestPermissionRequest,
  ): Promise<ResolvedDecision> {
    const permissionRequestId = request.toolCall.toolCallId
    const key = this.key(channelId, turnId, permissionRequestId)
    return new Promise<ResolvedDecision>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.parked.delete(key)
        reject(new PermissionExpiredError(turnId))
      }, this.defaultTimeoutMs)

      this.parked.set(key, {channelId, permissionRequestId, reject, request, resolve, timeoutHandle, turnId})
    })
  }

  /** Test-only: reject every parked request. Production code should use `decide` per turn. */
  public rejectAll(error: Error): void {
    for (const entry of this.parked.values()) {
      clearTimeout(entry.timeoutHandle)
      entry.reject(error)
    }

    this.parked.clear()
  }

  private key(channelId: string, turnId: string, permissionRequestId: string): string {
    return `${channelId}::${turnId}::${permissionRequestId}`
  }
}

/**
 * Pick the option whose `kind` matches the human-level decision. Falls back to
 * the first option if no match is found (defensive — every well-formed ACP
 * request is supposed to offer at least one allow + one reject).
 */
function pickOptionForDecision(options: PermissionOption[], decision: PermissionDecision): PermissionOption {
  const wanted: Array<PermissionOption['kind']> =
    decision === 'deny' ? ['reject_once', 'reject_always']
    : decision === 'always' ? ['allow_always', 'allow_once']
    : ['allow_once', 'allow_always']
  for (const kind of wanted) {
    const found = options.find((option) => option.kind === kind)
    if (found) return found
  }

  // No matching kind — return the first option so we don't synthesise a non-existent ID.
  // Callers will see this as `denied: false` (since the option's kind isn't reject_*) and
  // proceed; the worst case is an unexpected allow, which is preferable to inventing optionId.
  if (options.length === 0) {
    throw new Error('PermissionBroker: parked request has no options')
  }

  return options[0]
}
