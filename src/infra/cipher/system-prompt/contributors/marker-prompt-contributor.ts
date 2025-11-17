import type {SystemPromptContext} from '../../../../core/domain/cipher/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../../core/interfaces/cipher/i-system-prompt-contributor.js'
import type {PromptRenderer} from '../../resources/prompt-renderer.js'
import type {PromptResourceLoader} from '../../resources/prompt-resource-loader.js'

import {buildMarkerBasedPromptSections} from '../../prompt-factory/marker-prompt-builder.js'

/**
 * Contributor that generates prompt sections based on available tool markers.
 *
 * Loads marker-based prompt content from YAML and renders it based on
 * available tools and markers at runtime.
 */
export class MarkerPromptContributor implements ISystemPromptContributor {
  /**
   * Creates a new marker prompt contributor
   *
   * @param id - Unique identifier for this contributor
   * @param priority - Priority for ordering (lower = higher priority)
   * @param resourceLoader - Loader for YAML resources
   * @param renderer - Renderer for converting YAML to text
   */
  public constructor(
    public readonly id: string,
    public readonly priority: number,
    private readonly resourceLoader: PromptResourceLoader,
    private readonly renderer: PromptRenderer,
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

    // Load marker sections from YAML
    const markerSections = await this.resourceLoader.loadMarkerSections()

    // Build and return marker-based sections
    return buildMarkerBasedPromptSections(markerSections, this.renderer, availableMarkers, availableTools)
  }
}
