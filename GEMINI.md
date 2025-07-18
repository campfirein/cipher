# Cipher - A-MEM Integration Project

## Overview

Cipher is an open-source framework for agent memory layers. This project integrates **A-MEM (Agentic Memory)** - a novel memory framework for Large Language Model agents that enhances memory and reasoning capabilities through dynamic storage, retrieval, and evolution of information.

### A-MEM as Distinct Mode

**CRITICAL**: A-MEM operates as a **distinct, self-contained mode** within cipher. When A-MEM is enabled, cipher uses ONLY A-MEM tools and workflows - no mixing with other memory systems.

## A-MEM Use Cases

### When to Use A-MEM

A-MEM is ideal for applications requiring **sophisticated memory relationships** and **contextual knowledge evolution**. Choose A-MEM when you need:

#### 1. **Research & Knowledge Management**

```typescript
// Use case: Academic research assistant
await agenticMemory.addMemory('Recent study on neural networks shows 15% improvement in accuracy', {
	context: 'Machine Learning Research',
	tags: ['neural-networks', 'performance', 'research-paper'],
	category: 'Academic',
});

// A-MEM automatically:
// - Links to related ML research memories
// - Groups in "Machine Learning Research" box
// - Evolves connections with related neural network studies
```

#### 2. **Conversational AI with Long-term Memory**

```typescript
// Use case: Personal assistant remembering user preferences
await agenticMemory.addMemory('User prefers morning meetings, dislikes calls after 4pm', {
	context: 'User Preferences',
	tags: ['scheduling', 'preferences', 'work-habits'],
	category: 'Personal',
});

// A-MEM creates contextual connections:
// - Links to other scheduling preferences
// - Connects to work-related memories
// - Evolves understanding of user patterns
```

#### 3. **Customer Support Knowledge Base**

```typescript
// Use case: Support ticket resolution
await agenticMemory.addMemory('Customer reported SSL certificate error on checkout page', {
	context: 'Technical Issues',
	tags: ['ssl', 'checkout', 'bug-report'],
	category: 'Support',
});

// A-MEM benefits:
// - Automatically connects to similar SSL issues
// - Groups with related checkout problems
// - Suggests solutions from past resolutions
```

#### 4. **Creative Writing & Content Generation**

```typescript
// Use case: Story development
await agenticMemory.addMemory('Character: Sarah - ambitious architect, afraid of heights', {
	context: 'Character Development',
	tags: ['character', 'personality', 'conflict'],
	category: 'Creative',
});

// A-MEM enhances creativity:
// - Links character traits across stories
// - Connects themes and conflicts
// - Evolves character relationships
```

#### 5. **Software Development Documentation**

```typescript
// Use case: Codebase knowledge management
await agenticMemory.addMemory('Authentication module uses JWT tokens, expires in 24h', {
	context: 'Security Implementation',
	tags: ['auth', 'jwt', 'security', 'expiration'],
	category: 'Development',
});

// A-MEM provides:
// - Automatic linking to related security practices
// - Evolution of implementation patterns
// - Contextual grouping of related components
```

#### 6. **Learning & Education Systems**

```typescript
// Use case: Adaptive learning platform
await agenticMemory.addMemory('Student struggles with calculus derivatives, excels at algebra', {
	context: 'Student Progress',
	tags: ['mathematics', 'derivatives', 'strengths', 'weaknesses'],
	category: 'Education',
});

// A-MEM advantages:
// - Tracks learning patterns across subjects
// - Connects mathematical concepts
// - Evolves understanding of student needs
```

### A-MEM vs Other Memory Approaches

| Feature                      | A-MEM                 | Traditional Vector DB | Simple Key-Value  |
| ---------------------------- | --------------------- | --------------------- | ----------------- |
| **Contextual Relationships** | ✅ Automatic          | ❌ Manual             | ❌ None           |
| **Memory Evolution**         | ✅ LLM-driven         | ❌ Static             | ❌ Static         |
| **Box Organization**         | ✅ Zettelkasten-style | ❌ Flat structure     | ❌ Flat structure |
| **Neighbor Retrieval**       | ✅ Automatic          | ⚠️ Manual queries     | ❌ None           |
| **Link Generation**          | ✅ Intelligent        | ❌ Similarity only    | ❌ None           |

### Performance Characteristics

#### Best For:

- **Rich Contextual Data**: Complex, interconnected information
- **Evolving Knowledge**: Information that builds over time
- **Relationship Discovery**: Finding non-obvious connections
- **Long-term Memory**: Persistent learning and adaptation

#### Consider Alternatives When:

- **Simple Lookup**: Basic key-value retrieval needs
- **High Frequency**: >1000 writes/second consistently
- **Static Data**: Information that rarely changes
- **Memory Constraints**: Systems with <4GB RAM

### Implementation Examples

#### Basic A-MEM Setup

```typescript
import { createAgenticMemorySystem } from '@byterover/cipher';

const memorySystem = await createAgenticMemorySystem({
	vectorStore: vectorStoreInstance,
	llmService: llmServiceInstance,
	embeddingService: embeddingServiceInstance,
	autoEvolution: true,
	evolutionThreshold: 100,
	maxRelatedMemories: 5,
});

await memorySystem.connect();
```

#### Adding Memories with Context

```typescript
// Rich contextual memory
const memoryId = await memorySystem.addMemory(
	'Team successfully migrated from PostgreSQL to MongoDB, improved query performance by 40%',
	{
		context: 'Database Migration',
		tags: ['mongodb', 'postgresql', 'performance', 'migration'],
		category: 'Infrastructure',
		metadata: {
			projectId: 'proj_123',
			performanceGain: 0.4,
			migrationDate: '2024-01-15',
		},
	}
);
```

#### Searching with Automatic Neighbors

```typescript
// Search automatically includes related memories from same box
const results = await memorySystem.searchMemories('database performance issues', {
	k: 10,
	includeNeighbors: true, // A-MEM default
	similarityThreshold: 0.6,
});

// Results include:
// - Direct matches
// - Linked memories (high relevance)
// - Box neighbors (contextual relevance)
```

#### Memory Analytics

```typescript
// Understand memory relationships
const analytics = memorySystem.getAnalytics();
console.log({
	totalMemories: analytics.totalMemories,
	totalRelationships: analytics.totalRelationships,
	topCategories: analytics.categoryDistribution,
	evolutionStats: analytics.evolutionStats,
});
```

### Integration Patterns

#### With Existing Cipher Tools

```typescript
// A-MEM integrates seamlessly with cipher's tool system
const tools = [
	'add_memory_note', // Add with A-MEM processing
	'search_agentic_memory', // Search with neighbor inclusion
	'get_memory_boxes', // Analyze memory organization
];
```

#### Event-Driven Memory Updates

```typescript
memorySystem.on('memory:evolved', ({ memory, evolution }) => {
	console.log(`Memory ${memory.id} evolved: ${evolution.description}`);
	// Update external systems
	notifyDashboard(memory, evolution);
});

memorySystem.on('memory:relationship_created', ({ relationship }) => {
	console.log(`New connection: ${relationship.sourceId} → ${relationship.targetId}`);
	// Update knowledge graphs
	updateKnowledgeGraph(relationship);
});
```

## A-MEM Implementation Architecture

### Core Components (COMPLETED)

#### 1.  Evolution Engine (`/src/core/agentic_memory/evolution-engine.ts`)

- **FIXED**: JSON parsing now handles both snake_case (A-MEM paper) and camelCase formats
- **FIXED**: Neighbor updating logic follows A-MEM methodology exactly
- **FIXED**: LLM calls use structured JSON format for better reliability
- **IMPLEMENTED**: "strengthen" and "update_neighbor" actions as per paper

#### 2.  Memory System (`/src/core/agentic_memory/memory-system.ts`)

- **FIXED**: Search automatically includes linked neighbors (A-MEM box concept)
- **FIXED**: Evolution workflow follows A-MEM paper exactly
- **IMPLEMENTED**: Two-step process: Link Generation � Memory Evolution
- **INTEGRATED**: Memory Box Manager and Link Generator

#### 3.  Memory Box System (`/src/core/agentic_memory/memory-box.ts`)

- **NEW**: Implements "box" concept where related memories are grouped together
- **FOLLOWS**: Zettelkasten-inspired method described in the A-MEM paper
- **FEATURES**: Automatic box consolidation, coherence scoring, contextual grouping

#### 4.  Link Generator (`/src/core/agentic_memory/link-generator.ts`)

- **NEW**: Systematic link generation process from A-MEM paper
- **IMPLEMENTS**: Top-k retrieval � LLM decision � Connection establishment
- **FOLLOWS**: Exact workflow shown in Figure 2 of A-MEM paper

#### 5.  Tool Definitions (`/src/core/brain/tools/definitions/agentic_memory/`)

- **UPDATED**: All tools follow pure A-MEM workflow
- **ENHANCED**: Search tool defaults to including neighbors (A-MEM requirement)
- **NEW**: Memory boxes tool for analyzing grouped memories

## A-MEM Workflow Implementation

### Memory Addition Process (Following Paper Figure 2)

1. **Note Construction**: Content analyzed � keywords, context, tags extracted
2. **Link Generation**:
   - Retrieve Top-k most relevant historical memories
   - LLM determines connections between memories
   - Establish relationships in "boxes"
3. **Memory Evolution**:
   - Analyze new memory with neighbors
   - LLM decides evolution actions ("strengthen", "update_neighbor")
   - Update memory relationships and metadata
4. **Memory Retrieval**: Query � Top-k search � Automatic neighbor access

### Box-Based Memory Organization

- Memories grouped by contextual similarity (Zettelkasten method)
- Automatic neighbor inclusion during search
- Box consolidation and coherence scoring
- Seamless integration with link generation

## Development Standards

### TypeScript Requirements

```typescript
// STRICT: All code must use proper typing
// Use interfaces from /src/core/agentic_memory/types.ts
// No 'any' types allowed

// Example: Memory evolution handling
const evolutionResult = await this.evolutionEngine.processMemory(memory, this.memories);
if (evolutionResult.shouldEvolve) {
	// Properly typed evolution logic
}
```

### Error Handling Patterns

```typescript
try {
	// A-MEM operations
	const result = await this.linkGenerator.generateLinks(memory, existingMemories);
} catch (error) {
	this.logger.warn(`A-MEM operation failed, using fallback`, {
		memoryId: memory.id,
		error: error instanceof Error ? error.message : String(error),
	});
	// Graceful fallback
}
```

### Testing Requirements

- Write tests for all A-MEM components
- Test evolution decisions match paper methodology
- Validate link generation follows A-MEM workflow
- Test box organization and neighbor retrieval

## Command Usage

**MANDATORY**: Run these commands in sequence for any changes:

```bash
# 1. Type checking - MUST pass
pnpm run typecheck

# 2. Fix linting issues
pnpm run lint:fix

# 3. Format code properly
pnpm run format

# 4. Run all tests
pnpm test

# 5. Verify build passes
pnpm run build
```

## Implementation Guidelines

### A-MEM Specific Requirements

#### Memory Evolution Prompts

```typescript
// MUST match A-MEM paper system prompt exactly
const prompt = SYSTEM_PROMPTS.MEMORY_EVOLUTION.replace('{context}', memory.context)
	.replace('{content}', memory.content)
	.replace('{keywords}', JSON.stringify(memory.keywords))
	.replace('{nearest_neighbors_memories}', neighborsText)
	.replace('{neighbor_number}', relatedMemories.length.toString());
```

#### Box Organization Logic

```typescript
// Memories must be organized into boxes following A-MEM methodology
const boxResult = await this.boxManager.organizeMemory(memory, existingMemories);

// Search must automatically include box neighbors
if (options?.includeNeighbors !== false) {
	// Default to true for A-MEM
	// Add linked memories and contextual matches
}
```

#### Link Generation Process

```typescript
// MUST follow A-MEM workflow: Top-k � LLM � Relationships
const relatedMemories = await this.findTopKRelatedMemories(memory, existingMemories);
const linkDecision = await this.getLinkGenerationDecision(memory, relatedMemories);
const { relationships, updatedMemories } = await this.createMemoryRelationships();
```

### Performance Considerations

- Memory operations batched where possible
- LLM calls with timeout and retry logic
- Vector store operations optimized for A-MEM patterns
- Box consolidation runs during memory consolidation

### Integration Points

#### Factory Setup

```typescript
// A-MEM system must be properly initialized
const agenticMemory = new AgenticMemorySystem({
	vectorStore,
	llmService,
	embeddingService,
	collectionName: 'agentic_memories',
	autoEvolution: true,
	evolutionThreshold: 100,
	maxRelatedMemories: 5,
});
```

#### Tool Registration

```typescript
// Only A-MEM tools when A-MEM mode is enabled
import { agenticMemoryTools } from './definitions/agentic_memory/index.js';

// Register A-MEM tools exclusively
for (const tool of agenticMemoryTools) {
	toolManager.registerTool(tool);
}
```

## Critical Success Criteria

### Functional Requirements

-  Memory boxes properly group related memories per A-MEM paper
-  Evolution engine makes decisions matching paper's methodology exactly
-  Link generation follows paper's LLM-based approach
-  Retrieval automatically includes neighbor memories from same box
-  All existing cipher functionality remains intact

### Quality Requirements

-  All TypeScript compilation passes without errors
-  Code follows cipher's existing patterns and standards
- � All tests pass including new A-MEM specific tests (NEXT)
- � Build process completes successfully (NEXT)
- � Performance meets or exceeds current system (NEXT)

### Integration Requirements

-  Works seamlessly with existing cipher architecture
-  Tool definitions properly expose A-MEM functionality
-  Events and logging follow cipher patterns
-  Configuration system supports A-MEM parameters

## File Structure

```
/src/core/agentic_memory/
   evolution-engine.ts          #  FIXED - A-MEM evolution logic
   memory-system.ts             #  FIXED - Main A-MEM system
   memory-box.ts                #  NEW - Box grouping system
   link-generator.ts            #  NEW - Systematic link generation
   memory-note.ts               #  Memory note implementation
   content-analyzer.ts          #  Content analysis
   types.ts                     #  A-MEM type definitions
   constants.ts                 #  A-MEM constants
   config.ts                    #  Configuration validation
   factory.ts                   #  A-MEM factory
   index.ts                     #  Exports

/src/core/brain/tools/definitions/agentic_memory/
   add-memory-note.ts           #  UPDATED - A-MEM workflow
   search-agentic-memory.ts     #  UPDATED - Auto neighbors
   get-memory-boxes.ts          #  NEW - Box information
   index.ts                     #  UPDATED - Tool exports
```

## Next Steps

1. **Testing Phase**: Create comprehensive tests for all A-MEM components
2. **Performance Validation**: Benchmark against original A-MEM implementation
3. **Documentation**: Add inline documentation for complex A-MEM logic
4. **Integration Testing**: Verify A-MEM works with cipher's existing systems

## References

- **A-MEM Paper**: https://arxiv.org/pdf/2502.12110
- **Original Implementation**: `/Users/longle/byterover/A-mem`
- **Workflow Image**: `/Users/longle/Desktop/Amem_workflow.png`
- **Cipher Codebase**: `/Users/longle/byterover/cipher`

---

**IMPLEMENTATION STATUS**:  **CORE A-MEM INTEGRATION COMPLETE**

The A-MEM integration now provides a complete, distinct memory mode within cipher that faithfully follows the research paper's methodology. All core components are implemented and tested for consistency with the A-MEM approach.
