import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'

import {CONTEXT_TREE_DOMAINS} from '../../../../config/context-tree-domains.js'
import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Predefined domain category names for validation reference
 */
const PREDEFINED_DOMAIN_NAMES = CONTEXT_TREE_DOMAINS.map((domain) => domain.name)

/**
 * Domain category for knowledge classification.
 */
const DomainCategory = z
  .string()
  .min(1)
  .describe(
    `Domain category name. Must be one of the predefined categories: ${PREDEFINED_DOMAIN_NAMES.join(', ')}`,
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
          category: DomainCategory.describe('Domain category name from predefined list'),
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
export function createDetectDomainsTool(): Tool {
  const domainDescriptions = CONTEXT_TREE_DOMAINS.map(
    (domain) => `  - ${domain.name}: ${domain.description}`,
  ).join('\n')

  return {
    description: `Use this tool to analyze input data and detect which predefined knowledge domains are present. For each detected domain, you must also extract the specific text segments from the input data that relate to that domain.

This tool should be the first tool to call when you want to understand new data, unless you already know what you are looking for.

Predefined domain categories:
${domainDescriptions}

For each domain you detect:
1. Identify the domain category (must be one of the predefined categories above)
2. Extract relevant text segments from the input data that demonstrate why this domain is relevant
3. Each text segment should be a meaningful excerpt (not just keywords) that shows the connection to the domain
4. Only include domains that are actually present in the data - do not include domains just because they exist in the predefined list

The text segments will be used later to create organized knowledge topics, so they should be substantial enough to provide context.`,

    execute: executeDetectDomains,

    id: ToolName.DETECT_DOMAINS,
    inputSchema: DetectDomainsInputSchema,
  }
}
