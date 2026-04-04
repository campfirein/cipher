import type {VcErrorCodeType} from '../../../../shared/transport/events/vc-events.js'

export class VcError extends Error {
  public readonly code: VcErrorCodeType

  public constructor(message: string, code: VcErrorCodeType) {
    super(message)
    this.name = 'VcError'
    this.code = code
  }
}
