/**
 * Cross-Project Knowledge Transfer System
 *
 * Main entry point for the cross-project knowledge transfer system.
 * Provides automatic knowledge sharing and master guide functionality
 * across multiple projects.
 */

export { CrossProjectManager } from './cross-project-manager.js';
export { ProjectRegistryManager } from './project-registry.js';
export { KnowledgeSynthesizer } from './knowledge-synthesizer.js';
export { MasterGuideEngine } from './master-guide-engine.js';
export { MemoryIntegrationManager } from './memory-integration.js';

export type {
	ProjectKnowledge,
	KnowledgeTransfer,
	MasterGuide,
	KnowledgePattern,
	KnowledgeSolution,
	KnowledgeGuideline,
	CrossProjectConfig,
	ProjectRegistry,
	KnowledgeSynthesisResult,
	CrossProjectMetrics,
} from './types.js';

export type { CrossProjectManagerConfig } from './cross-project-manager.js';

export type { SynthesisOptions } from './knowledge-synthesizer.js';

export type { MasterGuideConfig } from './master-guide-engine.js';

export type { MemoryIntegrationConfig } from './memory-integration.js';
