import type {SystemPromptContext} from '../../../../core/domain/cipher/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../../core/interfaces/cipher/i-system-prompt-contributor.js'

import {buildMarkerBasedPromptSections} from '../../prompt-factory/marker-prompt-builder.js'

/**
 * Contributor that generates prompt sections based on available tool markers.
 *
 * This provides dynamic, marker-aware prompt sections without requiring
 * full template/config infrastructure.
 */
export class MarkerPromptContributor implements ISystemPromptContributor {
  public constructor(
    public readonly id: string,
    public readonly priority: number,
  ) {}

  /**
   * Generate marker-based prompt sections.
   *
   * @param context - System prompt context with available tools and markers
   * @returns Marker-based prompt sections
   */
  public async getContent(context: SystemPromptContext): Promise<string> {
    const availableMarkers = context.availableMarkers ?? new Set<string>()
    const availableTools = context.availableTools ?? []

    // Only generate content if we have markers to work with
    if (availableMarkers.size === 0 && availableTools.length === 0) {
      return ''
    }

    return buildMarkerBasedPromptSections(availableMarkers, availableTools)
  }
}
