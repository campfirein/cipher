import type { MetadataCallback, ToolMetadataUpdate } from '../../../../core/domain/cipher/tools/types.js'
import type { SessionEventBus } from '../../events/event-emitter.js'

/**
 * Handles real-time metadata streaming from tools during execution.
 *
 * Creates metadata callbacks that tools can use to push updates
 * (e.g., streaming bash output) which are then emitted as events.
 *
 * @example
 * ```typescript
 * const handler = new ToolMetadataHandler(eventBus)
 * const callback = handler.createCallback('call_123', 'bash_exec')
 *
 * // Tool can now stream updates:
 * callback({ output: 'Building...\n', description: 'Running npm build' })
 * callback({ output: 'Done!\n', progress: 100 })
 * ```
 */
export class ToolMetadataHandler {
  private readonly eventBus: SessionEventBus

  public constructor(eventBus: SessionEventBus) {
    this.eventBus = eventBus
  }

  /**
   * Creates a metadata callback for a specific tool call.
   * The callback will emit 'llmservice:toolMetadata' events when invoked.
   *
   * @param callId - Unique identifier for the tool call
   * @param toolName - Name of the tool being executed
   * @returns Callback function for the tool to push metadata updates
   */
  public createCallback(callId: string, toolName: string): MetadataCallback {
    return (update: ToolMetadataUpdate) => {
      this.eventBus.emit('llmservice:toolMetadata', {
        callId,
        metadata: update,
        toolName,
      })
    }
  }
}
