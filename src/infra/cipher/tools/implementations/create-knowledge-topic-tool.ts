import {join} from 'node:path'
import {z} from 'zod'

import type {Tool} from '../../../../core/domain/cipher/tools/types.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'
import {DirectoryManager} from '../../../../core/domain/knowledge/directory-manager.js'
import {MarkdownWriter} from '../../../../core/domain/knowledge/markdown-writer.js'

const CreateKnowledgeTopicInputSchema = z.object({
  // Base path for knowledge storage
  basePath: z.string().default('.brv/context-tree'),

  // Domains from detect_domains output
  domains: z.array(
    z.object({
      category: z.string().describe('Domain category name (e.g., ARCHITECTURE_DECISION)'),
      confidence: z.number().min(0).max(1).describe('Confidence score for domain'),
      description: z.string().describe('Description of the domain knowledge'),
      reasoning: z.string().optional().describe('Reasoning for domain classification'),
      snippets: z.array(z.string()).optional().describe('Code/text snippets'),
    }),
  ),

  // Manual topics (optional)
  topics: z
    .array(
      z.object({
        confidence: z.number().min(0).max(1),
        description: z.string(),
        domain: z.string(),
        name: z.string(),
        reasoning: z.string().optional(),
        relatedFiles: z.array(z.string()).optional(),
        subtopics: z
          .array(
            z.object({
              confidence: z.number().min(0).max(1),
              description: z.string(),
              name: z.string(),
              reasoning: z.string().optional(),
              relatedFiles: z.array(z.string()).optional(),
              snippets: z.array(z.string()).optional(),
              tags: z.array(z.string()).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

type CreateKnowledgeTopicInput = z.infer<typeof CreateKnowledgeTopicInputSchema>

interface CreateKnowledgeTopicOutput {
  created: {
    domains: number
    filesWritten: string[]
    subtopics: number
    topics: number
  }
  directoryStatus: {
    contextTreeExisted: boolean
    indexExisted: boolean
  }
  skipped: {
    files: number
    filesList: string[]
  }
  updated: {
    domains: number
    filesUpdated: string[]
    subtopics: number
    topics: number
  }
}

async function executeCreateKnowledgeTopic(
  input: CreateKnowledgeTopicInput,
): Promise<CreateKnowledgeTopicOutput> {
  const validatedInput = CreateKnowledgeTopicInputSchema.parse(input)

  const stats: CreateKnowledgeTopicOutput = {
    created: {
      domains: 0,
      filesWritten: [],
      subtopics: 0,
      topics: 0,
    },
    directoryStatus: {
      contextTreeExisted: false,
      indexExisted: false,
    },
    skipped: {
      files: 0,
      filesList: [],
    },
    updated: {
      domains: 0,
      filesUpdated: [],
      subtopics: 0,
      topics: 0,
    },
  }

  // 1. Ensure knowledge structure exists
  const dirStatus = await DirectoryManager.ensureKnowledgeStructure(validatedInput.basePath)
  stats.directoryStatus = dirStatus

  // 2. Process each domain
  // Sequential processing is required for file system operations
  /* eslint-disable no-await-in-loop */
  for (const domain of validatedInput.domains) {
    const domainPath = join(validatedInput.basePath, domain.category)

    // Create or update domain folder
    const domainResult = await DirectoryManager.createOrUpdateDomain(domainPath)
    if (domainResult.created) stats.created.domains++
    else if (domainResult.updated) stats.updated.domains++

    // Write domain metadata
    const metadataPath = join(domainPath, 'metadata.md')
    const domainMD = MarkdownWriter.generateDomainMetadata({
      category: domain.category,
      confidence: domain.confidence,
      description: domain.description,
      reasoning: domain.reasoning,
    })

    await DirectoryManager.ensureParentDirectory(metadataPath)
    await DirectoryManager.writeFileAtomic(metadataPath, domainMD)
    stats.created.filesWritten.push(metadataPath)

    // 3. Process manual topics if provided
    const topicsForDomain = validatedInput.topics?.filter((t) => t.domain === domain.category) || []

    for (const topic of topicsForDomain) {
      const topicPath = join(domainPath, topic.name)

      // Create or update topic folder
      const topicResult = await DirectoryManager.createOrUpdateTopic(topicPath)
      if (topicResult.created) stats.created.topics++
      else if (topicResult.updated) stats.updated.topics++

      // Write topic README
      const readmePath = join(topicPath, 'README.md')
      const topicMD = MarkdownWriter.generateTopicReadme({
        confidence: topic.confidence,
        description: topic.description,
        domain: topic.domain,
        name: topic.name,
        reasoning: topic.reasoning,
        relatedFiles: topic.relatedFiles,
        subtopics: topic.subtopics?.map((s) => s.name),
      })

      await DirectoryManager.ensureParentDirectory(readmePath)
      await DirectoryManager.writeFileAtomic(readmePath, topicMD)
      stats.created.filesWritten.push(readmePath)

      // 4. Process subtopics
      for (const subtopic of topic.subtopics || []) {
        const subtopicPath = join(topicPath, `${subtopic.name}.md`)

        // Check if subtopic file exists
        const exists = await DirectoryManager.fileExists(subtopicPath)

        if (exists) {
          // For now, skip existing subtopics (merge will be in future iteration)
          stats.skipped.files++
          stats.skipped.filesList.push(subtopicPath)
        } else {
          // Create new subtopic
          const subtopicMD = MarkdownWriter.generateSubtopic({
            confidence: subtopic.confidence,
            description: subtopic.description,
            domain: topic.domain,
            name: subtopic.name,
            parentTopic: topic.name,
            reasoning: subtopic.reasoning,
            relatedFiles: subtopic.relatedFiles,
            snippets: subtopic.snippets,
            tags: subtopic.tags,
          })

          await DirectoryManager.writeFileAtomic(subtopicPath, subtopicMD)
          stats.created.subtopics++
          stats.created.filesWritten.push(subtopicPath)
        }
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  return stats
}

/**
 * Creates the create knowledge topic tool.
 *
 * This tool takes output from detect_domains and creates hierarchical
 * Markdown files in .brv/context-tree/ for later retrieval.
 */
export function createCreateKnowledgeTopicTool(): Tool {
  return {
    description: `Create hierarchical knowledge structure from detected domains.

This tool takes the output from \`detect_domains\` and creates a structured Markdown hierarchy
in \`.brv/context-tree/\` for later navigation using \`find_knowledge_topic\`.

**Key Features:**
- **Non-destructive**: Never recreates existing .brv/context-tree/ directory
- **Incremental**: Safely adds new knowledge to existing structure
- **Merge-aware**: Skips existing files (future: merge support)
- **Atomic writes**: File operations are atomic to prevent corruption

**Input Format:**

\`\`\`json
{
  "domains": [
    {
      "category": "ARCHITECTURE_DECISION",
      "description": "Architectural patterns and decisions",
      "confidence": 0.92,
      "reasoning": "Multiple ADRs found",
      "snippets": ["We chose microservices because..."]
    }
  ],
  "topics": [
    {
      "domain": "ARCHITECTURE_DECISION",
      "name": "microservices",
      "description": "Microservices architecture",
      "confidence": 0.90,
      "subtopics": [
        {
          "name": "service-mesh",
          "description": "Istio service mesh implementation",
          "confidence": 0.85,
          "snippets": ["We use Istio for..."],
          "tags": ["istio", "observability"]
        }
      ]
    }
  ]
}
\`\`\`

**Created Structure:**

\`\`\`
.brv/context-tree/
├── ARCHITECTURE_DECISION/
│   ├── metadata.md
│   └── microservices/
│       ├── README.md
│       └── service-mesh.md
\`\`\`

**Output:**

Returns statistics about what was created, updated, or skipped:
- Number of domains/topics/subtopics created
- List of all files written
- Status of existing .brv/context-tree/
- Files skipped (already exist)

Use this tool after running \`detect_domains\` to persist knowledge in a navigable format.`,

    execute: executeCreateKnowledgeTopic as Tool['execute'],

    id: ToolName.CREATE_KNOWLEDGE_TOPIC,
    inputSchema: CreateKnowledgeTopicInputSchema,
  }
}
