import type {PromptRenderer} from '../resources/prompt-renderer.js'
import type {MarkerSectionsYaml} from '../resources/types.js'

/**
 * Simple marker-based prompt builder.
 *
 * Generates additional prompt sections based on available tool markers,
 * using externalized YAML content for maintainability.
 */

/**
 * Build additional prompt sections based on available tool markers.
 *
 * @param markerSectionsYaml - Loaded marker sections from YAML
 * @param renderer - Renderer for converting YAML to formatted strings
 * @param availableMarkers - Set of tool marker strings from registered tools
 * @param availableTools - Array of tool names
 * @returns Additional prompt text to append to base system prompt
 */
export function buildMarkerBasedPromptSections(
  markerSectionsYaml: MarkerSectionsYaml,
  renderer: PromptRenderer,
  availableMarkers: Set<string>,
  availableTools: string[],
): string {
  return renderer.renderMarkerSections(markerSectionsYaml.markers, availableMarkers, availableTools)
}
