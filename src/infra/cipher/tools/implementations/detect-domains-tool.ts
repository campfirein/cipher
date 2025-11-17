import {z} from 'zod'

import type {Tool} from '../../../../core/domain/cipher/tools/types.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Domain category for knowledge classification.
 * You can use predefined categories or create your own custom category names.
 * Predefined categories are suggestions - feel free to define new categories that better fit your analysis.
 */
const DomainCategory = z
  .string()
  .min(1)
  .describe(
    'Domain category name. Use predefined categories (STYLE_GUIDE, ARCHITECTURE_DECISION, NAMING, WORKFLOW, TROUBLESHOOTING, PERFORMANCE, PLAN, PITFALL) or create your own custom category name that better describes the knowledge domain.',
  )

/**
 * Input schema for detect domains tool
 */
const DetectDomainsInputSchema = z
  .object({
    /** JSON data content to analyze */
    content: z.string().describe('The JSON data content to analyze for domain detection'),

    /** Detected domains with metadata */
    domains: z
      .array(
        z.object({
          category: DomainCategory,
          confidence: z
            .number()
            .min(0)
            .max(1)
            .describe('Confidence score (0-1) for this domain classification'),
          description: z.string().describe('Brief description of what this domain knowledge entails'),
          reasoning: z.string().optional().describe('Explanation for why this was classified in this domain'),
          snippets: z
            .array(z.string())
            .optional()
            .describe('Relevant code or text snippets that support this classification'),
        }),
      )
      .describe('Array of detected domains with their classifications'),
  })
  .strict()

/**
 * Output type for detect domains tool
 */
interface DetectDomainsOutput {
  content: string
  domains: Array<{
    category: string
    confidence: number
    description: string
    reasoning?: string
    snippets?: string[]
  }>
  summary: {
    highConfidenceDomains: number
    totalDomains: number
  }
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

  // Calculate high confidence domains (>= 0.7)
  const highConfidenceDomains = validatedInput.domains.filter((d) => d.confidence >= 0.7).length

  return {
    content: validatedInput.content,
    domains: validatedInput.domains,
    summary: {
      highConfidenceDomains,
      totalDomains: validatedInput.domains.length,
    },
  }
}

/**
 * Creates the detect domains tool.
 *
 * This tool validates and categorizes knowledge domains that YOU have detected from analyzing JSON data.
 * It does NOT analyze data automatically - you must do all analysis yourself.
 *
 * Workflow:
 * 1. YOU receive JSON data in headless mode
 * 2. YOU analyze the content to identify domain patterns
 * 3. YOU classify knowledge into domain categories
 * 4. YOU create domain objects with category, description, confidence
 * 5. YOU call this tool with content and your detected domains array
 * 6. Tool validates and returns domains with summary statistics
 *
 * @returns Configured detect domains tool
 */
export function createDetectDomainsTool(): Tool {
  return {
    description: `Validate and categorize knowledge domains that YOU have detected from analyzing JSON data in headless mode.

**IMPORTANT:** This tool does NOT automatically analyze or detect domains. YOU must:
1. Analyze the JSON data content yourself
2. Identify patterns that match domain categories
3. Classify knowledge into appropriate domains
4. Create domain objects with category, description, confidence scores
5. Pass both the original content and your detected domains to this tool

**Domain Categories:**

You can use these predefined categories OR create your own custom category names that better fit your analysis:

**Predefined Categories (suggestions):**
- \`STYLE_GUIDE\`: Style & quality standards, code formatting rules, best practices
- \`ARCHITECTURE_DECISION\`: ADRs, "we decided to...", architectural choices and rationale
- \`NAMING\`: Naming conventions, identifier patterns, terminology standards
- \`WORKFLOW\`: CLI flows, Git workflows, development processes, procedures
- \`TROUBLESHOOTING\`: Debugging patterns, common issues, error resolution strategies
- \`PERFORMANCE\`: Performance notes, optimization tips, profiling insights
- \`PLAN\`: Implementation plans, "step 1..2..3", structured task breakdowns
- \`PITFALL\`: Weird behavior, "watch out", gotchas, anti-patterns

**Custom Categories:**
You are ENCOURAGED to create your own category names when:
- The predefined categories don't accurately capture the knowledge domain
- You identify a recurring pattern that deserves its own category
- The content fits better under a more specific or descriptive category name

Examples of custom categories: \`SECURITY_PATTERN\`, \`DATA_MODEL\`, \`API_CONTRACT\`, \`TESTING_STRATEGY\`, \`DEPLOYMENT_PROCESS\`, etc.

When creating custom categories, make sure the \`description\` field clearly explains what the category represents.

**Input format:**
\`\`\`json
{
  "content": "The original JSON data being analyzed",
  "domains": [
    {
      "category": "ARCHITECTURE_DECISION",
      "description": "Decision to use event-driven architecture for scalability",
      "confidence": 0.9,
      "snippets": ["We chose event sourcing because...", "CQRS pattern implementation"],
      "reasoning": "Multiple references to architectural decisions and rationale"
    },
    {
      "category": "STYLE_GUIDE",
      "description": "TypeScript naming conventions for interfaces",
      "confidence": 0.85,
      "snippets": ["All interfaces must start with 'I'"],
      "reasoning": "Clear style rule with examples"
    },
    {
      "category": "SECURITY_PATTERN",
      "description": "Authentication token validation patterns and best practices",
      "confidence": 0.88,
      "snippets": ["Always validate JWT signatures", "Use secure token storage"],
      "reasoning": "Custom category created to capture security-specific knowledge that doesn't fit predefined categories"
    }
  ]
}
\`\`\`

**Tool returns:**
\`\`\`json
{
  "content": "original content",
  "domains": [/* your validated domains */],
  "summary": {
    "totalDomains": 2,
    "highConfidenceDomains": 2  // domains with confidence >= 0.7
  }
}
\`\`\`

**Usage tips:**
- **Prefer custom categories** when predefined ones don't fit well - don't force content into predefined categories
- Provide confidence scores based on clarity and evidence strength
- Include snippets to support your classification
- Use reasoning field to explain non-obvious categorizations or custom category choices
- Multiple domains can be detected from the same content
- When creating custom categories, use clear, descriptive names (e.g., \`SECURITY_PATTERN\` not \`MISC\`)
- Make the \`description\` field comprehensive when using custom categories to help others understand the domain

The tool validates your domain classifications and returns them with summary statistics. Use this in headless mode to build context about code knowledge domains.`,

    execute: executeDetectDomains as Tool['execute'],

    id: ToolName.DETECT_DOMAINS,
    inputSchema: DetectDomainsInputSchema,
  }
}
