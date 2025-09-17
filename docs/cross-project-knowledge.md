# Cross-Project Knowledge Transfer System

A comprehensive system for sharing knowledge across multiple projects, generating master guides, and enabling automatic knowledge transfer between different development projects.

## Overview

The Cross-Project Knowledge Transfer System enables teams to:
- **Share knowledge** between different projects automatically
- **Generate master guides** that aggregate insights from multiple projects
- **Synthesize patterns** and solutions across project boundaries
- **Maintain knowledge consistency** across your entire development ecosystem

## Features

### 🚀 Core Functionality
- **Project Registry**: Register and manage multiple projects
- **Knowledge Transfer**: Automatic knowledge sharing between projects
- **Master Guide Generation**: Create comprehensive guides from project knowledge
- **Knowledge Synthesis**: Extract patterns, solutions, and guidelines
- **Performance Monitoring**: Track system performance and scalability

### 🔧 Integration Features
- **Memory Integration**: Seamless integration with existing memory tools
- **Automatic Detection**: Auto-detect and register new projects
- **Auto-Extraction**: Automatically extract knowledge from project content
- **Real-time Updates**: Live knowledge transfer and guide updates

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Cross-Project Knowledge System              │
├─────────────────────────────────────────────────────────────┤
│  Memory Integration Manager                                 │
│  ├── Auto Project Detection                                │
│  ├── Knowledge Extraction                                  │
│  └── Master Guide Generation                               │
├─────────────────────────────────────────────────────────────┤
│  Cross-Project Manager                                      │
│  ├── Project Registry Manager                              │
│  ├── Knowledge Synthesizer                                 │
│  └── Master Guide Engine                                   │
├─────────────────────────────────────────────────────────────┤
│  Storage Layer                                              │
│  ├── Project Knowledge Storage                             │
│  ├── Knowledge Transfer History                            │
│  └── Master Guide Repository                               │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Basic Usage

```typescript
import { CrossProjectManager } from '@cipher/core/cross_project_knowledge';

// Initialize the system
const manager = new CrossProjectManager({
  enableAutoTransfer: true,
  enableMasterGuide: true,
  similarityThreshold: 0.7
});

await manager.initialize();

// Register projects
await manager.registerProject({
  projectId: 'frontend-app',
  projectName: 'Frontend Application',
  domain: 'web-development',
  tags: ['react', 'typescript'],
  metadata: { framework: 'React 18' }
});

// Transfer knowledge between projects
await manager.transferKnowledge(
  'frontend-app',
  'backend-api',
  'Use TypeScript interfaces for API response validation',
  'pattern',
  0.9,
  0.8
);

// Generate master guide
const guide = await manager.generateMasterGuide(
  'web-development',
  'Web Development Master Guide'
);
```

### Advanced Usage with Memory Integration

```typescript
import { MemoryIntegrationManager } from '@cipher/core/cross_project_knowledge';

// Initialize with memory integration
const integrationManager = new MemoryIntegrationManager({
  enableAutoProjectDetection: true,
  enableAutoKnowledgeExtraction: true,
  enableAutoMasterGuideGeneration: true,
  knowledgeExtractionThreshold: 0.8
});

await integrationManager.initialize();

// Register project with automatic knowledge extraction
await integrationManager.registerProjectWithAutoExtraction({
  projectId: 'new-project',
  projectName: 'New Project',
  domain: 'web-development',
  tags: ['vue', 'typescript'],
  metadata: {}
}, [
  'Use Vue 3 Composition API for better reactivity',
  'Implement proper error handling with try-catch blocks',
  'Use TypeScript for type safety and better development experience'
]);

// The system will automatically:
// 1. Extract knowledge from the provided items
// 2. Transfer relevant knowledge to other projects in the same domain
// 3. Generate or update master guides for the domain
```

## API Reference

### CrossProjectManager

Main orchestrator for cross-project knowledge transfer.

#### Methods

- `initialize()`: Initialize the system
- `registerProject(project)`: Register a new project
- `transferKnowledge(source, target, knowledge, type, confidence, relevance)`: Transfer knowledge between projects
- `generateMasterGuide(domain, title?)`: Generate master guide for a domain
- `synthesizeKnowledge(domain?)`: Synthesize knowledge across projects
- `getMetrics()`: Get system metrics and performance data

### MemoryIntegrationManager

Advanced integration with automatic features.

#### Methods

- `initialize()`: Initialize the integration system
- `registerProjectWithAutoExtraction(project, knowledge?)`: Register project with automatic knowledge extraction
- `extractAndTransferKnowledge(projectId, knowledgeItems)`: Extract and transfer knowledge
- `generateMasterGuideWithSynthesis(domain, title?)`: Generate master guide with automatic synthesis

## Configuration

### CrossProjectManagerConfig

```typescript
interface CrossProjectManagerConfig {
  enableAutoTransfer: boolean;           // Enable automatic knowledge transfer
  enableMasterGuide: boolean;           // Enable master guide generation
  enablePerformanceMonitoring: boolean; // Enable performance monitoring
  similarityThreshold: number;          // Minimum similarity for transfers (0-1)
  maxTransferPerProject: number;        // Maximum transfers per project
  updateInterval: number;               // Auto-update interval (ms)
  masterGuideUpdateInterval: number;    // Master guide update interval (ms)
  knowledgeRetentionDays: number;       // Knowledge retention period (days)
  maxConcurrentTransfers: number;       // Maximum concurrent transfers
  transferBatchSize: number;            // Batch size for transfers
}
```

### MemoryIntegrationConfig

```typescript
interface MemoryIntegrationConfig extends CrossProjectManagerConfig {
  enableAutoProjectDetection: boolean;      // Enable automatic project detection
  enableAutoKnowledgeExtraction: boolean;  // Enable automatic knowledge extraction
  enableAutoMasterGuideGeneration: boolean; // Enable automatic master guide generation
  projectDetectionInterval: number;        // Project detection interval (ms)
  knowledgeExtractionThreshold: number;    // Minimum confidence for auto-extraction
  masterGuideGenerationThreshold: number;  // Minimum projects for auto-generation
}
```

## Knowledge Types

The system supports four types of knowledge:

### 1. **Patterns** (`pattern`)
Reusable code patterns and architectural approaches.
```typescript
// Example pattern knowledge
"Use custom hooks for reusable state logic and side effects"
"Implement compound component pattern for flexible UI components"
```

### 2. **Solutions** (`solution`)
Specific solutions to common problems.
```typescript
// Example solution knowledge
"Implement error boundaries with fallback UI for graceful error handling"
"Use React.memo and useMemo for performance optimization"
```

### 3. **Guidelines** (`guideline`)
Best practices and recommendations.
```typescript
// Example guideline knowledge
"Write integration tests with React Testing Library focusing on user behavior"
"Use environment variables for configuration management"
```

### 4. **Facts** (`fact`)
General information and facts about the project.
```typescript
// Example fact knowledge
"Project uses TypeScript for type safety"
"API endpoints follow RESTful conventions"
```

## Master Guide Generation

Master guides are automatically generated documents that aggregate knowledge from multiple projects in a domain.

### Guide Structure

```typescript
interface MasterGuide {
  id: string;
  title: string;
  description: string;
  domain: string;
  knowledgeSources: string[];    // Source project IDs
  content: string;              // Generated markdown content
  patterns: KnowledgePattern[]; // Extracted patterns
  solutions: KnowledgeSolution[]; // Extracted solutions
  guidelines: KnowledgeGuideline[]; // Generated guidelines
  lastUpdated: Date;
  version: string;
}
```

### Example Master Guide Content

```markdown
# Web Development Master Guide

Generated from 4 projects across 2 domains.

## Identified Patterns (8)

### Use Custom Hooks for State Logic
Use custom hooks for reusable state logic and side effects

**Confidence:** 90%
**Source Projects:** 3

### Implement Error Boundaries
Implement error boundaries with fallback UI for graceful error handling

**Confidence:** 95%
**Source Projects:** 4

## Effective Solutions (5)

### Performance Optimization
Use React.memo and useMemo for expensive component re-renders

**Effectiveness:** 90%

### Type Safety
Use TypeScript interfaces for API response validation

**Effectiveness:** 85%

## Guidelines (6)

### Pattern: Custom Hooks [BEST_PRACTICE]
Use custom hooks for reusable state logic and side effects

### Pattern: Error Boundaries [BEST_PRACTICE]
Implement error boundaries with fallback UI for graceful error handling
```

## Performance and Scalability

The system is designed to handle large-scale deployments:

### Performance Characteristics
- **Project Registration**: ~1ms per project
- **Knowledge Transfer**: ~5-10ms per transfer
- **Master Guide Generation**: ~100-500ms per guide
- **Knowledge Synthesis**: ~50-200ms per domain

### Scalability Limits
- **Projects**: Up to 10,000 projects
- **Knowledge Transfers**: Up to 100,000 transfers
- **Master Guides**: Up to 1,000 guides
- **Concurrent Operations**: Up to 100 concurrent operations

### Memory Usage
- **Per Project**: ~1-5KB
- **Per Transfer**: ~100-500 bytes
- **Per Master Guide**: ~10-50KB

## Testing

The system includes comprehensive tests and real-world testing capabilities:

### Test Categories
- **Unit Tests**: Individual component testing
- **Integration Tests**: Cross-component functionality
- **Performance Tests**: Scalability and performance analysis
- **Demo Tests**: Real-world scenario demonstrations
- **CLI Testing**: Real-world testing with cipher command

### Running Tests

```bash
# Run all tests
npm test src/core/cross_project_knowledge

# Run specific test categories
npm test src/core/cross_project_knowledge/__test__/cross-project-manager.test.ts
npm test src/core/cross_project_knowledge/__test__/demo.test.ts
npm test src/core/cross_project_knowledge/__test__/performance-analysis.test.ts
```

## Real-World Testing with Cipher CLI

### Prerequisites

1. **Build and Install Cipher**:
   ```bash
   # Build the project
   pnpm run build
   
   # Install globally
   npm link
   # or
   pnpm link --global
   ```

2. **Set Up Environment Variables**:
   Create a `.env` file in your project root:
   ```bash
   # Required API keys (at least one)
   OPENAI_API_KEY=your_openai_api_key_here
   # or
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   
   # Ollama for embeddings (as configured in cipher.yml)
   OLLAMA_BASE_URL=http://localhost:11434
   
   # Cross-project knowledge features
   CIPHER_CROSS_PROJECT_ENABLE_AUTO_PROJECT_DETECTION=true
   CIPHER_CROSS_PROJECT_ENABLE_AUTO_KNOWLEDGE_EXTRACTION=true
   CIPHER_CROSS_PROJECT_ENABLE_AUTO_MASTER_GUIDE_GENERATION=true
   CIPHER_CROSS_PROJECT_INTEGRATE_WITH_MEMORY=true
   CIPHER_CROSS_PROJECT_LOG_LEVEL=debug
   CIPHER_CROSS_PROJECT_ENABLE_DETAILED_LOGGING=true
   CIPHER_CROSS_PROJECT_LOG_TRANSFERS=true
   CIPHER_CROSS_PROJECT_LOG_SYNTHESIS=true
   ```

3. **Start Ollama (for embeddings)**:
   ```bash
   # Install and start Ollama
   curl -fsSL https://ollama.ai/install.sh | sh
   ollama serve
   
   # Pull the embedding model
   ollama pull mxbai-embed-large
   ```

### Testing Methods

#### 1. Interactive CLI Mode (Recommended)

```bash
# Start interactive mode
cipher

# Test cross-project knowledge features
cipher> "Register this project as a React e-commerce application with domain web-development"
cipher> "Store this knowledge: Use custom hooks for reusable state logic in React"
cipher> "What knowledge can I transfer from other similar projects?"
cipher> "Generate a master guide for React development based on all my projects"
```

#### 2. One-shot Command Mode

```bash
# Test single commands
cipher "Store this as knowledge: React best practices for state management"

# Test with metadata for cross-project features
cipher "!meta project=react-ecommerce,domain=web-development Store this as knowledge: How to handle complex forms in React with proper validation"

# Test knowledge transfer
cipher "Transfer this knowledge to other React projects: Use React.memo for performance optimization"
```

#### 3. MCP Server Mode (for IDE Integration)

```bash
# Start MCP server with cross-project features
MCP_SERVER_MODE=aggregator cipher --mode mcp

# Or with environment variables
export MCP_SERVER_MODE=aggregator
cipher --mode mcp
```

#### 4. Web UI Mode

```bash
# Start web interface
cipher --mode ui
# Then open http://localhost:3000 and test through the web interface
```

### Cross-Project Knowledge Testing Scenarios

#### Scenario 1: Multi-Project Knowledge Sharing

```bash
# Start interactive mode
cipher

# Register multiple projects
cipher> "Register project: ecommerce-frontend, React e-commerce app, web-development domain, tags: react,typescript,ecommerce"
cipher> "Register project: admin-dashboard, React admin panel, web-development domain, tags: react,typescript,dashboard"
cipher> "Register project: mobile-app, React Native app, mobile-development domain, tags: react-native,typescript"

# Store knowledge in each project
cipher> "Store in ecommerce-frontend: Use Redux Toolkit for state management with RTK Query for server state"
cipher> "Store in admin-dashboard: Implement role-based access control with React context and custom hooks"
cipher> "Store in mobile-app: Use React Navigation for screen management and deep linking"

# Test knowledge transfer
cipher> "What knowledge can I transfer from ecommerce-frontend to admin-dashboard?"
cipher> "Transfer Redux Toolkit pattern from ecommerce-frontend to admin-dashboard"
cipher> "Generate a master guide for React development across all projects"
```

#### Scenario 2: Domain-Specific Master Guide Generation

```bash
cipher> "Generate a comprehensive master guide for web-development based on all registered projects"
cipher> "What patterns are common across all my React projects?"
cipher> "Create a best practices guide for TypeScript usage in my projects"
```

#### Scenario 3: Automatic Knowledge Extraction

```bash
# Enable automatic features
export CIPHER_CROSS_PROJECT_ENABLE_AUTO_KNOWLEDGE_EXTRACTION=true
export CIPHER_CROSS_PROJECT_ENABLE_AUTO_MASTER_GUIDE_GENERATION=true

cipher> "Register new project: vue-admin, Vue.js admin panel, web-development domain"
cipher> "Extract knowledge from this code: Use Vuex for state management and Vue Router for navigation"
cipher> "Automatically transfer relevant knowledge to this new Vue project"
```

### Debugging and Monitoring

#### Enable Detailed Logging

```bash
# Set maximum debug level
export CIPHER_LOG_LEVEL=debug
export CIPHER_CROSS_PROJECT_ENABLE_DETAILED_LOGGING=true
export CIPHER_CROSS_PROJECT_LOG_TRANSFERS=true
export CIPHER_CROSS_PROJECT_LOG_SYNTHESIS=true

# Run cipher with full logging
cipher
```

#### Monitor Cross-Project Operations

```bash
# Watch for specific events
cipher> "Show me all registered projects"
cipher> "Show me recent knowledge transfers"
cipher> "Show me master guide generation status"
cipher> "Show me system metrics and performance"
```

### Expected Test Results

When testing cross-project knowledge features, you should see:

1. **Project Registration**:
   ```
   [INFO] Project registered: ecommerce-frontend
   [INFO] Project metadata: { domain: 'web-development', tags: ['react', 'typescript'] }
   ```

2. **Knowledge Transfer**:
   ```
   [INFO] Knowledge transferred from ecommerce-frontend to admin-dashboard
   [INFO] Transfer ID: transfer_1234567890_abc123
   [INFO] Similarity score: 0.85
   ```

3. **Master Guide Generation**:
   ```
   [INFO] Generating master guide for web-development
   [INFO] Found 3 projects in domain: web-development
   [INFO] Master guide generated: Web Development Master Guide v1.0
   ```

4. **Knowledge Synthesis**:
   ```
   [INFO] Synthesizing knowledge across 3 projects
   [INFO] Found 5 common patterns, 3 solutions, 8 guidelines
   [INFO] Knowledge synthesis completed
   ```

### Troubleshooting Common Issues

#### 1. Ollama Connection Issues
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# If not running, start it
ollama serve
```

#### 2. API Key Issues
```bash
# Verify API keys are set
echo $OPENAI_API_KEY
echo $ANTHROPIC_API_KEY
```

#### 3. Cross-Project Features Not Working
```bash
# Check if features are enabled
echo $CIPHER_CROSS_PROJECT_ENABLE_AUTO_PROJECT_DETECTION
echo $CIPHER_CROSS_PROJECT_ENABLE_AUTO_KNOWLEDGE_EXTRACTION

# Enable all features
export CIPHER_CROSS_PROJECT_ENABLE_AUTO_PROJECT_DETECTION=true
export CIPHER_CROSS_PROJECT_ENABLE_AUTO_KNOWLEDGE_EXTRACTION=true
export CIPHER_CROSS_PROJECT_ENABLE_AUTO_MASTER_GUIDE_GENERATION=true
```

#### 4. Memory Integration Issues
```bash
# Check memory integration
export CIPHER_CROSS_PROJECT_INTEGRATE_WITH_MEMORY=true
export CIPHER_CROSS_PROJECT_INTEGRATE_WITH_KNOWLEDGE_GRAPH=true

# Test memory storage
cipher "Store this in memory and make it available across projects: Use TypeScript for better code quality"
```

### Performance Testing

```bash
# Test with multiple projects
for i in {1..10}; do
  cipher "Register project: test-project-$i, Test Project $i, test-domain, tags: test,project-$i"
done

# Test knowledge transfer performance
cipher "Transfer all relevant knowledge between all test projects"

# Test master guide generation performance
cipher "Generate master guide for test-domain with all projects"
```

### Integration with Existing Memory System

```bash
# Test integration with existing memory tools
cipher "Store this reasoning: When debugging React performance issues, use React DevTools Profiler to identify bottlenecks"
cipher "Search for similar debugging patterns across all projects"
cipher "Create a debugging master guide from all project knowledge"
```

## Examples

### Example 1: React Development Team

```typescript
// Register React projects
await manager.registerProject({
  projectId: 'ecommerce-frontend',
  projectName: 'E-commerce Frontend',
  domain: 'react-development',
  tags: ['react', 'typescript', 'ecommerce'],
  metadata: { framework: 'React 18' }
});

await manager.registerProject({
  projectId: 'admin-dashboard',
  projectName: 'Admin Dashboard',
  domain: 'react-development',
  tags: ['react', 'typescript', 'dashboard'],
  metadata: { framework: 'React 18' }
});

// Transfer knowledge between projects
await manager.transferKnowledge(
  'ecommerce-frontend',
  'admin-dashboard',
  'Use Redux Toolkit with RTK Query for server state management',
  'pattern',
  0.9,
  0.9
);

// Generate master guide
const guide = await manager.generateMasterGuide(
  'react-development',
  'React Development Master Guide'
);
```

### Example 2: Multi-Domain Knowledge Sharing

```typescript
// Register projects from different domains
await manager.registerProject({
  projectId: 'frontend-app',
  projectName: 'Frontend App',
  domain: 'frontend-development',
  tags: ['vue', 'typescript'],
  metadata: {}
});

await manager.registerProject({
  projectId: 'backend-api',
  projectName: 'Backend API',
  domain: 'backend-development',
  tags: ['nodejs', 'express'],
  metadata: {}
});

// Cross-domain knowledge transfer
await manager.transferKnowledge(
  'frontend-app',
  'backend-api',
  'Implement CORS middleware for cross-origin requests',
  'solution',
  0.9,
  0.9
);

// Generate domain-specific guides
const frontendGuide = await manager.generateMasterGuide('frontend-development');
const backendGuide = await manager.generateMasterGuide('backend-development');
```

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Reduce `maxTransferPerProject`
   - Decrease `knowledgeRetentionDays`
   - Enable `enablePerformanceMonitoring`

2. **Slow Master Guide Generation**
   - Increase `masterGuideUpdateInterval`
   - Reduce `maxConcurrentTransfers`
   - Filter projects by domain

3. **Low Knowledge Transfer Quality**
   - Increase `similarityThreshold`
   - Improve knowledge content quality
   - Adjust `knowledgeExtractionThreshold`

### Debug Mode

Enable debug logging:

```typescript
const manager = new CrossProjectManager({
  enablePerformanceMonitoring: true,
  // ... other config
});

// Monitor system events
manager.on('projectRegistered', (project) => {
  console.log('Project registered:', project.projectId);
});

manager.on('knowledgeTransferred', (transfer) => {
  console.log('Knowledge transferred:', transfer.id);
});

manager.on('masterGuideGenerated', (guide) => {
  console.log('Master guide generated:', guide.title);
});
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

This project is licensed under the Elastic License 2.0 - see the [LICENSE](../../../LICENSE) file for details.
