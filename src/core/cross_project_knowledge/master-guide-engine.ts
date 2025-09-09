/**
 * Master Guide Engine - Generates comprehensive guides from cross-project knowledge
 * 
 * Creates and maintains master guides that aggregate knowledge from multiple
 * projects into comprehensive, actionable guides for teams to follow.
 * 
 * Why this exists: Teams need consolidated guidance from multiple projects.
 * This engine synthesizes knowledge into master guides that provide clear,
 * actionable recommendations based on proven patterns and solutions.
 */

import { EventEmitter } from 'events';
import { logger } from '../index.js';
import { KnowledgeSynthesizer } from './knowledge-synthesizer.js';
import { loadCrossProjectConfig } from './cross-project-config.js';
import type {
	ProjectKnowledge,
	KnowledgeTransfer,
	MasterGuide,
	KnowledgeSynthesisResult,
	CrossProjectConfig,
} from './types.js';

/**
 * Configuration for master guide generation behavior
 * 
 * Controls guide creation, updates, and versioning to balance
 * guide quality with resource usage and maintenance overhead.
 */
export interface MasterGuideConfig {
	/** Enable automatic guide generation and updates */
	enableAutoGeneration: boolean;
	/** How often to update guides (milliseconds) */
	updateInterval: number;
	/** Minimum projects needed to create a guide */
	minProjectsForGuide: number;
	/** Maximum age before guide expires (days) */
	maxGuideAge: number;
	/** Enable versioning for guide updates */
	enableVersioning: boolean;
	/** Enable guides that span multiple domains */
	enableCrossDomainGuides: boolean;
}

/**
 * Generates and maintains master guides from cross-project knowledge
 * 
 * Uses knowledge synthesis to create comprehensive guides that teams
 * can follow, with automatic updates and versioning support.
 */
export class MasterGuideEngine extends EventEmitter {
	private synthesizer: KnowledgeSynthesizer;
	private config: MasterGuideConfig;
	private guides: Map<string, MasterGuide> = new Map();
	private updateTimer?: NodeJS.Timeout;

	/**
	 * Creates guide engine with configuration from environment variables
	 * 
	 * @param config - Optional partial config to override environment settings
	 * 
	 * Loads configuration from environment variables with sensible defaults.
	 * Can be overridden with partial config for testing or custom setups.
	 */
	constructor(config: Partial<MasterGuideConfig> = {}) {
		super();
		
		// Load configuration from environment variables
		const envConfig = loadCrossProjectConfig();
		
		// Merge environment config with provided overrides
		this.config = {
			...envConfig.masterGuideConfig,
			...config,
		};
		
		// Initialize synthesizer with environment-based configuration
		this.synthesizer = new KnowledgeSynthesizer(envConfig.synthesisOptions);
	}

	/**
	 * Generates a master guide for a specific domain
	 * 
	 * @param domain - Domain to generate guide for
	 * @param projects - Projects to include in guide
	 * @param transfers - Knowledge transfers to analyze
	 * @param title - Optional custom title for guide
	 * @returns Generated master guide
	 * @throws Error if insufficient projects or generation fails
	 */
	async generateMasterGuide(
		domain: string,
		projects: ProjectKnowledge[],
		transfers: KnowledgeTransfer[],
		title?: string
	): Promise<MasterGuide> {
		const startTime = Date.now();

		try {
			logger.info('Generating master guide', {
				domain,
				projectCount: projects.length,
				transferCount: transfers.length,
			});

			// Filter to domain-specific projects
			const domainProjects = projects.filter(p => p.domain === domain);

			if (domainProjects.length < this.config.minProjectsForGuide) {
				throw new Error(
					`Insufficient projects for domain ${domain}. Need at least ${this.config.minProjectsForGuide}, found ${domainProjects.length}`
				);
			}

			// Synthesize knowledge for domain
			const synthesis = await this.synthesizer.synthesizeKnowledge(
				domainProjects,
				transfers,
				domain
			);

			// Create guide with synthesized content
			const guideId = `guide_${domain}_${Date.now()}`;
			const masterGuide: MasterGuide = {
				id: guideId,
				title: title || `${domain} Master Guide`,
				description: `Comprehensive guide for ${domain} based on knowledge from ${domainProjects.length} projects`,
				domain,
				knowledgeSources: domainProjects.map(p => p.projectId),
				content: synthesis.synthesizedKnowledge,
				patterns: synthesis.patterns,
				solutions: synthesis.patterns.map(p => ({
					id: `solution_${p.id}`,
					problem: p.name,
					solution: p.description,
					context: p.pattern,
					effectiveness: p.confidence,
					sourceProjects: p.sourceProjects,
					relatedPatterns: [p.id],
				})),
				guidelines: synthesis.patterns.map(p => ({
					id: `guideline_${p.id}`,
					title: `Pattern: ${p.name}`,
					content: p.description,
					category: 'best_practice' as const,
					priority: p.confidence > 0.8 ? ('high' as const) : ('medium' as const),
					sourceProjects: p.sourceProjects,
				})),
				lastUpdated: new Date(),
				version: '1.0.0',
			};

			this.guides.set(guideId, masterGuide);

			const generationTime = Date.now() - startTime;
			logger.info('Master guide generated successfully', {
				guideId,
				domain,
				generationTime,
				patterns: synthesis.patterns.length,
				confidence: synthesis.confidence,
			});

			this.emit('masterGuideGenerated', masterGuide);
			return masterGuide;
		} catch (error) {
			logger.error('Failed to generate master guide', {
				domain,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Update an existing master guide
	 */
	async updateMasterGuide(
		guideId: string,
		projects: ProjectKnowledge[],
		transfers: KnowledgeTransfer[]
	): Promise<MasterGuide> {
		const existingGuide = this.guides.get(guideId);
		if (!existingGuide) {
			throw new Error(`Master guide ${guideId} not found`);
		}

		const startTime = Date.now();

		try {
			logger.info('Updating master guide', {
				guideId,
				domain: existingGuide.domain,
			});

			// Re-synthesize knowledge
			const synthesis = await this.synthesizer.synthesizeKnowledge(
				projects,
				transfers,
				existingGuide.domain
			);

			// Update the guide
			const updatedGuide: MasterGuide = {
				...existingGuide,
				content: synthesis.synthesizedKnowledge,
				patterns: synthesis.patterns,
				solutions: synthesis.patterns.map(p => ({
					id: `solution_${p.id}`,
					problem: p.name,
					solution: p.description,
					context: p.pattern,
					effectiveness: p.confidence,
					sourceProjects: p.sourceProjects,
					relatedPatterns: [p.id],
				})),
				guidelines: synthesis.patterns.map(p => ({
					id: `guideline_${p.id}`,
					title: `Pattern: ${p.name}`,
					content: p.description,
					category: 'best_practice' as const,
					priority: p.confidence > 0.8 ? ('high' as const) : ('medium' as const),
					sourceProjects: p.sourceProjects,
				})),
				lastUpdated: new Date(),
				version: this.incrementVersion(existingGuide.version),
			};

			this.guides.set(guideId, updatedGuide);

			const updateTime = Date.now() - startTime;
			logger.info('Master guide updated successfully', {
				guideId,
				updateTime,
				newVersion: updatedGuide.version,
			});

			this.emit('masterGuideUpdated', updatedGuide);
			return updatedGuide;
		} catch (error) {
			logger.error('Failed to update master guide', {
				guideId,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Get a master guide by ID
	 */
	getMasterGuide(guideId: string): MasterGuide | undefined {
		return this.guides.get(guideId);
	}

	/**
	 * Get all master guides
	 */
	getAllMasterGuides(): MasterGuide[] {
		return Array.from(this.guides.values());
	}

	/**
	 * Get master guides by domain
	 */
	getMasterGuidesByDomain(domain: string): MasterGuide[] {
		return Array.from(this.guides.values()).filter(guide => guide.domain === domain);
	}

	/**
	 * Search master guides by content
	 */
	searchMasterGuides(query: string): MasterGuide[] {
		const searchTerm = query.toLowerCase();
		return Array.from(this.guides.values()).filter(
			guide =>
				guide.title.toLowerCase().includes(searchTerm) ||
				guide.description.toLowerCase().includes(searchTerm) ||
				guide.content.toLowerCase().includes(searchTerm)
		);
	}

	/**
	 * Start automatic master guide generation and updates
	 */
	startAutoGeneration(): void {
		if (this.updateTimer) {
			clearInterval(this.updateTimer);
		}

		this.updateTimer = setInterval(() => {
			this.performAutoUpdate();
		}, this.config.updateInterval);

		logger.info('Master guide auto-generation started', {
			updateInterval: this.config.updateInterval,
		});
	}

	/**
	 * Stop automatic master guide generation
	 */
	stopAutoGeneration(): void {
		if (this.updateTimer) {
			clearInterval(this.updateTimer);
   this.updateTimer = undefined as any;
		}

		logger.info('Master guide auto-generation stopped');
	}

	/**
	 * Perform automatic updates
	 */
	private async performAutoUpdate(): Promise<void> {
		try {
			const cutoffDate = new Date(Date.now() - this.config.maxGuideAge * 24 * 60 * 60 * 1000);
			const oldGuides = Array.from(this.guides.values()).filter(
				guide => guide.lastUpdated < cutoffDate
			);

			// Remove old guides
			for (const guide of oldGuides) {
				this.guides.delete(guide.id);
				logger.debug('Removed old master guide', {
					guideId: guide.id,
					lastUpdated: guide.lastUpdated,
				});
			}

			this.emit('autoUpdateCompleted', {
				removedGuides: oldGuides.length,
				timestamp: new Date(),
			});
		} catch (error) {
			logger.error('Auto-update failed', {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	/**
	 * Increment version number
	 */
	private incrementVersion(version: string): string {
		if (!this.config.enableVersioning) {
			return version;
		}

		const parts = version.split('.');
		if (parts.length !== 3) {
			return '1.0.0';
		}

  const major = parseInt(parts[0] || "0", 10);
  const minor = parseInt(parts[1] || "0", 10);
  const patch = parseInt(parts[2] || "0", 10);

		// Increment patch version
		return `${major}.${minor}.${patch + 1}`;
	}

	/**
	 * Get master guide statistics
	 */
	getStatistics(): {
		totalGuides: number;
		guidesByDomain: Record<string, number>;
		averagePatterns: number;
		averageSolutions: number;
		averageGuidelines: number;
	} {
		const guides = Array.from(this.guides.values());
		const guidesByDomain: Record<string, number> = {};

		for (const guide of guides) {
			guidesByDomain[guide.domain] = (guidesByDomain[guide.domain] || 0) + 1;
		}

		return {
			totalGuides: guides.length,
			guidesByDomain,
			averagePatterns:
				guides.length > 0
					? guides.reduce((sum, g) => sum + g.patterns.length, 0) / guides.length
					: 0,
			averageSolutions:
				guides.length > 0
					? guides.reduce((sum, g) => sum + g.solutions.length, 0) / guides.length
					: 0,
			averageGuidelines:
				guides.length > 0
					? guides.reduce((sum, g) => sum + g.guidelines.length, 0) / guides.length
					: 0,
		};
	}

	/**
	 * Get master guides by domain
	 */
	getGuidesByDomain(domain: string): MasterGuide[] {
		return Array.from(this.guides.values()).filter(guide => guide.domain === domain);
	}

	/**
	 * Cleanup resources
	 */
	destroy(): void {
		this.stopAutoGeneration();
		this.removeAllListeners();
		this.guides.clear();
	}
}
