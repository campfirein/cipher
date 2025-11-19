import {z} from 'zod'

import type {Tool} from '../../../../core/domain/cipher/tools/types.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Domain category for knowledge classification.
 */
const DomainCategory = z
  .string()
  .min(1)
  .describe(
    'Domain category name. Use predefined categories (code_style, design, structure, compliance, testing, bug_fixes)',
  )

/**
 * Input schema for detect domains tool
 */
const DetectDomainsInputSchema = z
  .object({
    /** Detected domains with metadata */
    domains: z
      .array(
        z.object({
          category: DomainCategory
        }),
      )
      .describe('Array of detected domains categories'),
  })

/**
 * Output type for detect domains tool
 */
interface DetectDomainsOutput {
  domains: Array<{
    category: string
  }>
}

/**
 * Input type derived from schema
 */
type DetectDomainsInputType = z.infer<typeof DetectDomainsInputSchema>

/**
 * Execute function for detect domains tool with typed input
 */
async function executeDetectDomains(input: DetectDomainsInputType): Promise<DetectDomainsOutput> {
  const validatedInput = DetectDomainsInputSchema.parse(input)

  return {
    domains: validatedInput.domains,
  }
}

/**
 * Creates the detect domains tool.
 *
 * @returns Configured detect domains tool
 */
export function createDetectDomainsTool(): Tool {
  return {
    description: `Use this tool to get a high-level understanding of the domains of knowledge in the data. This tool will return the domains that you have detected in the content. This should be the first tool to call when you want to understand a new data, unless you already know what you are looking for. only generate the domains in the predefined categories.`,

    execute: executeDetectDomains as Tool['execute'],

    id: ToolName.DETECT_DOMAINS,
    inputSchema: DetectDomainsInputSchema,
  }
}
