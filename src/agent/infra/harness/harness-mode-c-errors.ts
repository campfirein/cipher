/**
 * Errors surfaced when a harness invocation trips a Mode C safety cap.
 * Carry a machine-readable `code` + structured `details` so observability
 * (Phase 7 CLI debug, metrics) can distinguish cap types without
 * string-parsing.
 */
export type HarnessModeCErrorCode = 'OPS_CAP_EXCEEDED' | 'RATE_CAP_THROTTLED'

export class HarnessModeCError extends Error {
  constructor(
    message: string,
    public readonly code: HarnessModeCErrorCode,
    public readonly details: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'HarnessModeCError'
  }
}
