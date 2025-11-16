import {z} from 'zod'

import type {SegmentConversationOutput} from '../../../../core/domain/cipher/segmentation/types.js'
import type {Tool} from '../../../../core/domain/cipher/tools/types.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Input schema for segment conversation tool
 */
const SegmentConversationInputSchema = z
  .object({
    /** Array of episodes to return */
    episodes: z
      .array(
        z.object({
          id: z.string().describe('Unique identifier for the episode'),
          summary: z.string().describe('Brief description of what was accomplished in this episode'),
          title: z.string().describe('Human-readable title summarizing the episode'),
        }),
      )
      .describe('Array of conversation episodes'),
  })
  .strict()

/**
 * Input type derived from schema
 */
type SegmentConversationInputType = z.infer<typeof SegmentConversationInputSchema>

/**
 * Execute function for segment conversation tool with typed input
 */
async function executeSegmentConversation(
  input: SegmentConversationInputType,
): Promise<SegmentConversationOutput> {
  const validatedInput = SegmentConversationInputSchema.parse(input)

  return {
    episodes: validatedInput.episodes,
    totalEpisodes: validatedInput.episodes.length,
  }
}

/**
 * Creates the segment conversation tool.
 *
 * This tool validates and registers conversation episodes that YOU have created.
 * It does NOT analyze conversations automatically - you must do all analysis yourself.
 *
 * Workflow:
 * 1. YOU analyze the conversation history
 * 2. YOU identify episode boundaries (time gaps, topic switches, context changes)
 * 3. YOU create episode objects with id, title, summary
 * 4. YOU call this tool with your episodes array
 * 5. Tool validates and returns episodes with total count
 *
 * @returns Configured segment conversation tool
 */
export function createSegmentConversationTool(): Tool {
  return {
    description: `Validate and register conversation episodes that YOU have created from analyzing the conversation history.

**IMPORTANT:** This tool does NOT automatically analyze conversations. YOU must:
1. Review all messages in the conversation yourself
2. Identify natural task boundaries (time gaps, topic switches, context changes)
3. Create episode objects for each segment you identified
4. Pass your created episodes to this tool

**Input format:**
\`\`\`
{
  episodes: [
    {
      id: "episode-1",           // Unique identifier you assign
      title: "Setup Project",    // Clear title you write
      summary: "Created project structure and configured TypeScript"  // Brief summary you write
    },
    // ... more episodes
  ]
}
\`\`\`

**Tool returns:**
\`\`\`
{
  episodes: [/* your episodes */],
  totalEpisodes: 3              // Count of episodes
}
\`\`\`

The tool validates your episode structure and returns them with a total count. It does not add any additional metadata - you must track message indices, timestamps, triggers, and context switches yourself during your analysis.`,

    execute: executeSegmentConversation as Tool['execute'],

    id: ToolName.SEGMENT_CONVERSATION,
    inputSchema: SegmentConversationInputSchema,
  }
}
