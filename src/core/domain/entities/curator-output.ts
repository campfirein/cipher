import {DeltaBatch, type DeltaBatchJson} from './delta-batch.js'

/**
 * Output from the curator phase.
 * Contains the delta operations to apply to the playbook.
 */
export class CuratorOutput {
  public readonly delta: DeltaBatch

  public constructor(delta: DeltaBatch) {
    this.delta = delta
  }

  /**
   * Creates a CuratorOutput instance from a JSON object
   */
  public static fromJson(json: DeltaBatchJson): CuratorOutput {
    const delta = DeltaBatch.fromJson(json)
    return new CuratorOutput(delta)
  }

  public toJson(): DeltaBatchJson {
    return {
      ...this.delta.toJson()
    }
  }
}
