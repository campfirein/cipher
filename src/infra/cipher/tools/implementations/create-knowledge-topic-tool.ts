import {join} from 'node:path'
import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'
import {DirectoryManager} from '../../../../core/domain/knowledge/directory-manager.js'
import {MarkdownWriter} from '../../../../core/domain/knowledge/markdown-writer.js'
import {sanitizeFolderName} from '../../../../utils/file-helpers.js'

const CreateKnowledgeTopicInputSchema = z.object({
  // Base path for knowledge storage
  basePath: z.string().default('.brv/context-tree'),
  domains: z.array(z.string()).describe('Array of domain names'),
  // Manual topics (optional)
  topics: z
    .array(
      z.object({
        domain: z.string().describe('Domain category name from predefined list'),
        name: z.string().describe('Topic name'),
        relations: z
          .array(z.string())
          .optional()
          .describe('Related topics using domain/topic or domain/topic/subtopic notation'),
        snippets: z.array(z.string()).describe('Code/text snippets'),
        subtopics: z
          .array(
            z.object({
              name: z.string().describe('Subtopic name'),
              relations: z
                .array(z.string())
                .optional()
                .describe('Related topics using domain/topic or domain/topic/subtopic notation'),
              snippets: z.array(z.string()).describe('Code/text snippets'),
            }),
          )
          .describe('Array of subtopics'),
      }),
    )
    .describe('Array of topics for each domain'),
})

type CreateKnowledgeTopicInput = z.infer<typeof CreateKnowledgeTopicInputSchema>

/**
 * Output type for create knowledge topic tool
 */
interface CreateKnowledgeTopicOutput {
  created: Array<{
    domain: string
    subtopics: string[]
    topic: string
  }>
  updated: Array<{
    domain: string
    subtopics: string[]
    topic: string
  }>
}

/**
 * Execute function for create knowledge topic tool
 */
async function executeCreateKnowledgeTopic(
  input: unknown,
  _context?: ToolExecutionContext,
): Promise<CreateKnowledgeTopicOutput> {
  const {basePath, topics} = input as CreateKnowledgeTopicInput

  // Ensure base knowledge structure exists
  await DirectoryManager.ensureKnowledgeStructure(basePath)

  const created: Array<{domain: string; subtopics: string[]; topic: string}> = []
  const updated: Array<{domain: string; subtopics: string[]; topic: string}> = []

  // Process each topic sequentially (domains/topics must be created in order)
  /* eslint-disable no-await-in-loop -- Sequential processing required for domain/topic hierarchy */
  for (const topicData of topics) {
    const {domain, name: topicName, relations, snippets, subtopics: subtopicData} = topicData

    // Create or update domain folder
    const domainPath = join(basePath, sanitizeFolderName(domain))
    const domainResult = await DirectoryManager.createOrUpdateDomain(domainPath)

    // Create or update topic folder
    const topicPath = join(domainPath, sanitizeFolderName(topicName))
    const topicResult = await DirectoryManager.createOrUpdateTopic(topicPath)

    // Generate and write topic context.md
    const topicContextContent = MarkdownWriter.generateContext({
      name: topicName,
      relations,
      snippets,
    })
    const topicContextPath = join(topicPath, 'context.md')
    await DirectoryManager.writeFileAtomic(topicContextPath, topicContextContent)

    // Process subtopics in parallel
    const subtopicResults = await Promise.all(
      subtopicData.map(async (subtopic) => {
        // Create subtopic folder
        const subtopicPath = join(topicPath, sanitizeFolderName(subtopic.name))
        const subtopicResult = await DirectoryManager.createOrUpdateTopic(subtopicPath)

        // Generate and write subtopic context.md
        const subtopicContextContent = MarkdownWriter.generateContext({
          name: subtopic.name,
          relations: subtopic.relations,
          snippets: subtopic.snippets,
        })
        const subtopicContextPath = join(subtopicPath, 'context.md')
        await DirectoryManager.writeFileAtomic(subtopicContextPath, subtopicContextContent)

        return {
          existed: !subtopicResult.created,
          name: subtopic.name,
        }
      }),
    )

    // Separate created vs updated subtopics
    const createdSubtopics = subtopicResults.filter((r) => !r.existed).map((r) => r.name)
    const updatedSubtopics = subtopicResults.filter((r) => r.existed).map((r) => r.name)

    // Track what was created vs updated
    if (domainResult.created || topicResult.created) {
      created.push({
        domain,
        subtopics: createdSubtopics,
        topic: topicName,
      })
    } else {
      updated.push({
        domain,
        subtopics: updatedSubtopics,
        topic: topicName,
      })
    }
  }
  /* eslint-enable no-await-in-loop */

  return {
    created,
    updated,
  }
}

/**
 * Creates the create knowledge topic tool.
 *
 * Creates organized knowledge topics within domain folders, where each topic and subtopic
 * has its own folder containing a context.md file with relevant snippets. This tool should
 * be used after detecting domains to organize the extracted knowledge into a structured hierarchy.
 *
 * @returns Configured create knowledge topic tool
 */
export function createCreateKnowledgeTopicTool(): Tool {
  return {
    description: `Create organized knowledge topics within domain folders. This tool structures knowledge by creating topic and subtopic folders, each containing a context.md file with relevant snippets and optional relations.

Use this tool after detecting domains to organize extracted knowledge into a hierarchical structure:
- Domain folders (e.g., .brv/context-tree/domain-name/)
- Topic folders (e.g., .brv/context-tree/domain-name/topic-name/)
- Topic context.md files (e.g., .brv/context-tree/domain-name/topic-name/context.md)
- Subtopic folders (e.g., .brv/context-tree/domain-name/topic-name/subtopic-name/)
- Subtopic context.md files (e.g., .brv/context-tree/domain-name/topic-name/subtopic-name/context.md)

Each topic should include:
1. A clear topic name
2. Relevant code/text snippets that demonstrate the knowledge
3. Optional relations to other topics using domain/topic or domain/topic/subtopic notation
4. Subtopics (optional) that break down the topic into smaller pieces

Relations enhance knowledge discovery by linking related contexts. Example:
- relations: ['code_style/error-handling', 'structure/api-endpoints/validation']

The tool automatically:
- Creates the base knowledge structure if it doesn't exist
- Creates topic and subtopic folders as needed
- Generates context.md files with snippets and relations
- Handles existing topics gracefully (updates instead of recreating)`,

    execute: executeCreateKnowledgeTopic,

    id: ToolName.CREATE_KNOWLEDGE_TOPIC,
    inputSchema: CreateKnowledgeTopicInputSchema,
  }
}
