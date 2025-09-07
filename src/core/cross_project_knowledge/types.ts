/**
 * Cross-Project Knowledge Transfer System Types
 *
 * This module defines the types and interfaces for the cross-project knowledge
 * transfer system, enabling knowledge sharing and master guide functionality
 * across multiple projects.
 */

export interface ProjectKnowledge {
	projectId: string;
	projectName: string;
	domain: string;
	lastUpdated: Date;
	knowledgeCount: number;
	tags: string[];
	metadata: Record<string, any>;
}

export interface KnowledgeTransfer {
	id: string;
	sourceProjectId: string;
	targetProjectId: string;
	knowledgeType: 'fact' | 'pattern' | 'solution' | 'guideline';
	content: string;
	confidence: number;
	relevance: number;
	transferredAt: Date;
	metadata: Record<string, any>;
}

export interface MasterGuide {
	id: string;
	title: string;
	description: string;
	domain: string;
	knowledgeSources: string[]; // Project IDs
	content: string;
	patterns: KnowledgePattern[];
	solutions: KnowledgeSolution[];
	guidelines: KnowledgeGuideline[];
	lastUpdated: Date;
	version: string;
}

export interface KnowledgePattern {
	id: string;
	name: string;
	description: string;
	pattern: string;
	examples: string[];
	confidence: number;
	sourceProjects: string[];
}

export interface KnowledgeSolution {
	id: string;
	problem: string;
	solution: string;
	context: string;
	effectiveness: number;
	sourceProjects: string[];
	relatedPatterns: string[];
}

export interface KnowledgeGuideline {
	id: string;
	title: string;
	content: string;
	category: 'best_practice' | 'anti_pattern' | 'warning' | 'tip';
	priority: 'high' | 'medium' | 'low';
	sourceProjects: string[];
}

export interface CrossProjectConfig {
	enableAutoTransfer: boolean;
	similarityThreshold: number;
	maxTransferPerProject: number;
	updateInterval: number; // in milliseconds
	enableMasterGuide: boolean;
	masterGuideUpdateInterval: number; // in milliseconds
	knowledgeRetentionDays: number;
}

export interface ProjectRegistry {
	projects: Map<string, ProjectKnowledge>;
	transfers: Map<string, KnowledgeTransfer>;
	masterGuides: Map<string, MasterGuide>;
	lastSync: Date;
}

export interface KnowledgeSynthesisResult {
	synthesizedKnowledge: string;
	sourceProjects: string[];
	confidence: number;
	patterns: KnowledgePattern[];
	recommendations: string[];
}

export interface CrossProjectMetrics {
	totalProjects: number;
	totalTransfers: number;
	totalMasterGuides: number;
	averageConfidence: number;
	lastUpdate: Date;
	performanceMetrics: {
		averageTransferTime: number;
		averageSynthesisTime: number;
		cacheHitRate: number;
	};
}
