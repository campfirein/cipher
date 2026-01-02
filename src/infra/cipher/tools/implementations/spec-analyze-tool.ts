import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Domain category for knowledge classification.
 * Domains are created dynamically based on content semantics.
 */
const DomainCategory = z
  .string()
  .min(1)
  .describe(
    'Domain category name. Create semantically meaningful domain names based on content (e.g., authentication, api_design, data_models). Use snake_case format.',
  )

/**
 * Text segment schema - represents a portion of the input data related to a domain
 */
const TextSegmentSchema = z
  .string()
  .min(1)
  .describe('A segment of text from the input data that relates to this domain category')

/**
 * Input schema for detect domains tool
 */
const DetectDomainsInputSchema = z
  .object({
    /** Detected domains with metadata and related text segments */
    domains: z
      .array(
        z.object({
          category: DomainCategory.describe('Semantically meaningful domain category name (snake_case, e.g., authentication, api_design)'),
          textSegments: z
            .array(TextSegmentSchema)
            .min(1)
            .describe(
              'Array of text segments from the input data that relate to this domain. Each segment should be a meaningful excerpt that demonstrates why this domain is relevant.',
            ),
        }),
      )
      .describe('Array of detected domains with their related text segments from the input data'),
  })

/**
 * Output type for detect domains tool
 */
interface DetectDomainsOutput {
  domains: Array<{
    category: string
    textSegments: string[]
  }>
}

/**
 * Input type derived from schema
 */
type DetectDomainsInputType = z.infer<typeof DetectDomainsInputSchema>

/**
 * Execute function for detect domains tool with typed input
 */
async function executeDetectDomains(
  input: unknown,
  _context?: ToolExecutionContext,
): Promise<DetectDomainsOutput> {
  const {domains} = input as DetectDomainsInputType

  return {
    domains,
  }
}

/**
 * Creates the detect domains tool.
 *
 * @returns Configured detect domains tool
 */
export function createSpecAnalyzeTool(): Tool {
  return {
    description: `Use this tool to analyze input data and detect which knowledge domains are present. For each detected domain, you must also extract the specific text segments from the input data that relate to that domain.

This tool should be the first tool to call when you want to understand new data, unless you already know what you are looking for.

**Dynamic Domain Creation:**
Domains are created dynamically based on the semantics of the content. Choose domain names that:
- Are descriptive and semantically meaningful
- Use snake_case format (1-3 words)
- Group related concepts together
- Examples: \`authentication\`, \`api_design\`, \`data_models\`, \`error_handling\`, \`ui_components\`, \`testing_patterns\`

**For each domain you detect:**
1. Create a semantically meaningful domain category name based on the content
2. Extract relevant text segments from the input data that demonstrate why this domain is relevant
3. Each text segment should be a meaningful excerpt (not just keywords) that shows the connection to the domain
4. Only include domains that are actually present in the data

**Domain Naming Guidelines:**
- Use noun-based names that describe the category (e.g., \`authentication\` not \`how_to_authenticate\`)
- Avoid overly generic names (e.g., \`misc\`, \`other\`, \`general\`)
- Avoid overly specific names that only fit one topic
- Consolidate related concepts under the same domain

The text segments will be used later to create organized knowledge topics, so they should be substantial enough to provide context.`,

    execute: executeDetectDomains,

    id: ToolName.SPEC_ANALYZE,
    inputSchema: DetectDomainsInputSchema,
  }
}
