/**
 * Cross-Project Knowledge Transfer System Types
 * 
 * Defines all interfaces and types for the cross-project knowledge system.
 * These types enable knowledge sharing, pattern recognition, and master
 * guide generation across multiple projects.
 * 
 * Why this exists: Strong typing ensures data consistency and makes the
 * system more maintainable. These types define the contract for all
 * cross-project knowledge operations.
 */

/**
 * Represents a project in the cross-project knowledge system
 * 
 * Contains project identification, domain classification, and metadata
 * for knowledge sharing and pattern recognition.
 */
export interface ProjectKnowledge {
	/** Unique identifier for the project */
	projectId: string;
	/** Human-readable project name */
	projectName: string;
	/** Domain/category for grouping related projects */
	domain: string;
	/** When the project was last updated */
	lastUpdated: Date;
	/** Number of knowledge items in this project */
	knowledgeCount: number;
	/** Tags for categorization and filtering */
	tags: string[];
	/** Additional project metadata */
	metadata: Record<string, any>;
}

/**
 * Represents a knowledge transfer between projects
 * 
 * Tracks knowledge sharing events with quality metrics and metadata
 * for analysis and pattern recognition.
 */
export interface KnowledgeTransfer {
	/** Unique identifier for this transfer */
	id: string;
	/** Project providing the knowledge */
	sourceProjectId: string;
	/** Project receiving the knowledge */
	targetProjectId: string;
	/** Type of knowledge being transferred */
	knowledgeType: 'fact' | 'pattern' | 'solution' | 'guideline';
	/** The actual knowledge content */
	content: string;
	/** Quality score (0-1) for the knowledge */
	confidence: number;
	/** Relevance score (0-1) to target project */
	relevance: number;
	/** When the transfer occurred */
	transferredAt: Date;
	/** Additional transfer metadata */
	metadata: Record<string, any>;
}

/**
 * Represents a master guide generated from cross-project knowledge
 * 
 * Comprehensive guide that aggregates knowledge from multiple projects
 * into actionable recommendations and best practices.
 */
export interface MasterGuide {
	/** Unique identifier for this guide */
	id: string;
	/** Human-readable title */
	title: string;
	/** Brief description of the guide */
	description: string;
	/** Domain this guide covers */
	domain: string;
	/** Project IDs that contributed to this guide */
	knowledgeSources: string[];
	/** Main guide content in markdown format */
	content: string;
	/** Patterns identified from cross-project analysis */
	patterns: KnowledgePattern[];
	/** Solutions extracted from cross-project knowledge */
	solutions: KnowledgeSolution[];
	/** Guidelines generated from patterns and solutions */
	guidelines: KnowledgeGuideline[];
	/** When the guide was last updated */
	lastUpdated: Date;
	/** Version number for tracking changes */
	version: string;
}

/**
 * Represents a recurring pattern identified across projects
 * 
 * Patterns are common approaches, practices, or architectural decisions
 * that appear consistently across multiple projects in the same domain.
 */
export interface KnowledgePattern {
	/** Unique identifier for this pattern */
	id: string;
	/** Human-readable pattern name */
	name: string;
	/** Brief description of the pattern */
	description: string;
	/** The actual pattern text/content */
	pattern: string;
	/** Examples of this pattern in practice */
	examples: string[];
	/** Confidence score (0-1) for pattern reliability */
	confidence: number;
	/** Project IDs that contributed to this pattern */
	sourceProjects: string[];
}

/**
 * Represents a solution to a common problem
 * 
 * Solutions are specific approaches to problems that have proven
 * effective across multiple projects in the same domain.
 */
export interface KnowledgeSolution {
	/** Unique identifier for this solution */
	id: string;
	/** Problem statement this solution addresses */
	problem: string;
	/** The solution approach/implementation */
	solution: string;
	/** Context for when to apply this solution */
	context: string;
	/** Effectiveness score (0-1) for this solution */
	effectiveness: number;
	/** Project IDs that contributed to this solution */
	sourceProjects: string[];
	/** Related pattern IDs that support this solution */
	relatedPatterns: string[];
}

/**
 * Represents a guideline derived from cross-project knowledge
 * 
 * Guidelines are actionable recommendations that help teams
 * follow best practices and avoid common pitfalls.
 */
export interface KnowledgeGuideline {
	/** Unique identifier for this guideline */
	id: string;
	/** Human-readable guideline title */
	title: string;
	/** Detailed guideline content */
	content: string;
	/** Type of guideline for categorization */
	category: 'best_practice' | 'anti_pattern' | 'warning' | 'tip';
	/** Priority level for implementation */
	priority: 'high' | 'medium' | 'low';
	/** Project IDs that contributed to this guideline */
	sourceProjects: string[];
}

/**
 * Configuration for cross-project knowledge system behavior
 * 
 * Controls system features, performance limits, and update intervals
 * to balance functionality with resource usage.
 */
export interface CrossProjectConfig {
	/** Enable automatic knowledge transfer between projects */
	enableAutoTransfer: boolean;
	/** Minimum similarity (0-1) for knowledge matching */
	similarityThreshold: number;
	/** Maximum transfers allowed per project */
	maxTransferPerProject: number;
	/** How often to run auto-updates (milliseconds) */
	updateInterval: number;
	/** Enable master guide generation and updates */
	enableMasterGuide: boolean;
	/** How often to update master guides (milliseconds) */
	masterGuideUpdateInterval: number;
	/** How long to keep knowledge before expiring (days) */
	knowledgeRetentionDays: number;
}

/**
 * Central registry for all cross-project knowledge data
 * 
 * Provides centralized storage for projects, transfers, and guides
 * with synchronization tracking for data consistency.
 */
export interface ProjectRegistry {
	/** Map of project ID to project knowledge */
	projects: Map<string, ProjectKnowledge>;
	/** Map of transfer ID to knowledge transfer */
	transfers: Map<string, KnowledgeTransfer>;
	/** Map of guide ID to master guide */
	masterGuides: Map<string, MasterGuide>;
	/** When the registry was last synchronized */
	lastSync: Date;
}

/**
 * Result of knowledge synthesis process
 * 
 * Contains the synthesized knowledge content along with patterns,
 * recommendations, and quality metrics from cross-project analysis.
 */
export interface KnowledgeSynthesisResult {
	/** Synthesized knowledge content in markdown format */
	synthesizedKnowledge: string;
	/** Project IDs that contributed to this synthesis */
	sourceProjects: string[];
	/** Overall confidence score (0-1) for the synthesis */
	confidence: number;
	/** Patterns identified during synthesis */
	patterns: KnowledgePattern[];
	/** Actionable recommendations for teams */
	recommendations: string[];
}

/**
 * Performance and usage metrics for the cross-project knowledge system
 * 
 * Tracks system usage, performance, and quality metrics for monitoring
 * and optimization of cross-project knowledge operations.
 */
export interface CrossProjectMetrics {
	/** Total number of registered projects */
	totalProjects: number;
	/** Total number of knowledge transfers */
	totalTransfers: number;
	/** Total number of master guides */
	totalMasterGuides: number;
	/** Average confidence score across all knowledge */
	averageConfidence: number;
	/** When metrics were last updated */
	lastUpdate: Date;
	/** Detailed performance metrics */
	performanceMetrics: {
		/** Average time for knowledge transfers (milliseconds) */
		averageTransferTime: number;
		/** Average time for knowledge synthesis (milliseconds) */
		averageSynthesisTime: number;
		/** Cache hit rate (0-1) for performance optimization */
		cacheHitRate: number;
	};
}
