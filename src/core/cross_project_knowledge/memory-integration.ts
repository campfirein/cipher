/**
 * Memory Integration for Cross-Project Knowledge Transfer
 *
 * Integrates the cross-project knowledge transfer system with existing
 * memory tools to enable automatic knowledge sharing and master guide generation.
 */

import { EventEmitter } from 'events';
import { logger } from '../index.js';
import { CrossProjectManager } from './cross-project-manager.js';
import type {
	ProjectKnowledge,
	KnowledgeTransfer,
	MasterGuide,
	CrossProjectConfig,
} from './types.js';

export interface MemoryIntegrationConfig extends CrossProjectConfig {
	enableAutoProjectDetection: boolean;
	enableAutoKnowledgeExtraction: boolean;
	enableAutoMasterGuideGeneration: boolean;
	projectDetectionInterval: number; // in milliseconds
	knowledgeExtractionThreshold: number; // minimum confidence for auto-extraction
	masterGuideGenerationThreshold: number; // minimum projects for auto-generation
}

export class MemoryIntegrationManager extends EventEmitter {
	private crossProjectManager: CrossProjectManager;
	private config: MemoryIntegrationConfig;
	private isRunning = false;
	private projectDetectionTimer?: NodeJS.Timeout;
	private registeredProjects = new Set<string>();

	constructor(config: Partial<MemoryIntegrationConfig> = {}) {
		super();

		this.config = {
			enableAutoProjectDetection: true,
			enableAutoKnowledgeExtraction: true,
			enableAutoMasterGuideGeneration: true,
			projectDetectionInterval: 5 * 60 * 1000, // 5 minutes
			knowledgeExtractionThreshold: 0.8,
			masterGuideGenerationThreshold: 2,
			enableAutoTransfer: true,
			enableMasterGuide: true,
			similarityThreshold: 0.7,
			maxTransferPerProject: 100,
			updateInterval: 60 * 60 * 1000, // 1 hour
			masterGuideUpdateInterval: 24 * 60 * 60 * 1000, // 24 hours
			knowledgeRetentionDays: 30,
			...config,
		};

		this.crossProjectManager = new CrossProjectManager(this.config);
		this.setupEventHandlers();
	}

	/**
	 * Initialize the memory integration system
	 */
	async initialize(): Promise<void> {
		try {
			logger.info('Initializing memory integration system', {
				config: {
					enableAutoProjectDetection: this.config.enableAutoProjectDetection,
					enableAutoKnowledgeExtraction: this.config.enableAutoKnowledgeExtraction,
					enableAutoMasterGuideGeneration: this.config.enableAutoMasterGuideGeneration,
				},
			});

			await this.crossProjectManager.initialize();

			if (this.config.enableAutoProjectDetection) {
				this.startProjectDetection();
			}

			this.isRunning = true;
			this.emit('initialized');

			logger.info('Memory integration system initialized successfully');
		} catch (error) {
			logger.error('Failed to initialize memory integration system', {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Register a project with automatic knowledge extraction
	 */
	async registerProjectWithAutoExtraction(
		project: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'>,
		existingKnowledge?: string[]
	): Promise<void> {
		try {
			// Register the project
			await this.crossProjectManager.registerProject(project);
			this.registeredProjects.add(project.projectId);

			// If existing knowledge is provided, extract and transfer it
			if (existingKnowledge && existingKnowledge.length > 0) {
				await this.extractAndTransferKnowledge(project.projectId, existingKnowledge);
			}

			// Check if we should generate master guides
			if (this.config.enableAutoMasterGuideGeneration) {
				await this.checkAndGenerateMasterGuides(project.domain);
			}

			this.emit('projectRegistered', project);
		} catch (error) {
			logger.error('Failed to register project with auto-extraction', {
				projectId: project.projectId,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Extract knowledge from project and transfer to other projects
	 */
	async extractAndTransferKnowledge(
		projectId: string,
		knowledgeItems: string[]
	): Promise<string[]> {
		const transferIds: string[] = [];

		try {
			const project = this.crossProjectManager.getProject(projectId);
			if (!project) {
				throw new Error(`Project ${projectId} not found`);
			}

			// Get other projects in the same domain
			const otherProjects = this.crossProjectManager
				.getAllProjects()
				.filter(p => p.domain === project.domain && p.projectId !== projectId);

			if (otherProjects.length === 0) {
				logger.info('No other projects found in domain for knowledge transfer', {
					projectId,
					domain: project.domain,
				});
				return transferIds;
			}

			// Extract and transfer each knowledge item
			for (const knowledge of knowledgeItems) {
				if (this.shouldExtractKnowledge(knowledge)) {
					// Determine knowledge type and confidence
					const { type, confidence, relevance } = this.analyzeKnowledge(knowledge);

					// Transfer to other projects in the same domain
					for (const targetProject of otherProjects) {
						try {
							const transferId = await this.crossProjectManager.transferKnowledge(
								projectId,
								targetProject.projectId,
								knowledge,
								type,
								confidence,
								relevance
							);
							transferIds.push(transferId);
						} catch (error) {
							logger.warn('Failed to transfer knowledge to project', {
								sourceProject: projectId,
								targetProject: targetProject.projectId,
								knowledge: knowledge.substring(0, 100),
								error: error instanceof Error ? error.message : 'Unknown error',
							});
						}
					}
				}
			}

			logger.info('Knowledge extraction and transfer completed', {
				projectId,
				knowledgeItems: knowledgeItems.length,
				transfers: transferIds.length,
			});

			this.emit('knowledgeExtracted', {
				projectId,
				knowledgeItems: knowledgeItems.length,
				transfers: transferIds.length,
			});

			return transferIds;
		} catch (error) {
			logger.error('Failed to extract and transfer knowledge', {
				projectId,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Generate master guide for a domain with automatic content synthesis
	 */
	async generateMasterGuideWithSynthesis(domain: string, title?: string): Promise<MasterGuide> {
		try {
			// First, ensure all projects in the domain have their knowledge extracted
			const domainProjects = this.crossProjectManager
				.getAllProjects()
				.filter(p => p.domain === domain);

			for (const project of domainProjects) {
				if (!this.registeredProjects.has(project.projectId)) {
					// This project might have been registered outside of our system
					// Try to extract knowledge from it
					await this.attemptKnowledgeExtraction(project.projectId);
				}
			}

			// Generate the master guide
			const masterGuide = await this.crossProjectManager.generateMasterGuide(domain, title);

			this.emit('masterGuideGenerated', masterGuide);
			return masterGuide;
		} catch (error) {
			logger.error('Failed to generate master guide with synthesis', {
				domain,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Get integrated system status
	 */
	getIntegratedStatus(): {
		isRunning: boolean;
		registeredProjects: number;
		totalProjects: number;
		totalTransfers: number;
		totalMasterGuides: number;
		config: MemoryIntegrationConfig;
	} {
		const systemStatus = this.crossProjectManager.getSystemStatus();

		return {
			isRunning: this.isRunning,
			registeredProjects: this.registeredProjects.size,
			totalProjects: systemStatus.metrics.totalProjects,
			totalTransfers: systemStatus.metrics.totalTransfers,
			totalMasterGuides: systemStatus.metrics.totalMasterGuides,
			config: this.config,
		};
	}

	/**
	 * Setup event handlers
	 */
	private setupEventHandlers(): void {
		this.crossProjectManager.on('projectRegistered', project => {
			this.emit('projectRegistered', project);
		});

		this.crossProjectManager.on('knowledgeTransferred', transfer => {
			this.emit('knowledgeTransferred', transfer);
		});

		this.crossProjectManager.on('masterGuideGenerated', guide => {
			this.emit('masterGuideGenerated', guide);
		});
	}

	/**
	 * Start automatic project detection
	 */
	private startProjectDetection(): void {
		if (this.projectDetectionTimer) {
			clearInterval(this.projectDetectionTimer);
		}

		this.projectDetectionTimer = setInterval(() => {
			this.detectAndRegisterProjects();
		}, this.config.projectDetectionInterval);

		logger.info('Project detection started', {
			interval: this.config.projectDetectionInterval,
		});
	}

	/**
	 * Detect and register new projects automatically
	 */
	private async detectAndRegisterProjects(): Promise<void> {
		try {
			// This would typically scan the filesystem or workspace for new projects
			// For now, we'll just emit an event for external project detection
			this.emit('projectDetectionRequired', {
				timestamp: new Date(),
				registeredProjects: this.registeredProjects.size,
			});
		} catch (error) {
			logger.error('Project detection failed', {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	/**
	 * Check if knowledge should be extracted based on confidence and relevance
	 */
	private shouldExtractKnowledge(knowledge: string): boolean {
		// Basic heuristics for knowledge quality
		if (knowledge.length < 10) return false;
		if (knowledge.length > 1000) return false; // Too long, might be noise

		// Check for knowledge indicators
		const knowledgeIndicators = [
			'pattern',
			'solution',
			'best practice',
			'guideline',
			'tip',
			'implement',
			'use',
			'avoid',
			'recommend',
			'suggest',
		];

		const hasIndicators = knowledgeIndicators.some(indicator =>
			knowledge.toLowerCase().includes(indicator)
		);

		return hasIndicators;
	}

	/**
	 * Analyze knowledge to determine type, confidence, and relevance
	 */
	private analyzeKnowledge(knowledge: string): {
		type: 'fact' | 'pattern' | 'solution' | 'guideline';
		confidence: number;
		relevance: number;
	} {
		const lowerKnowledge = knowledge.toLowerCase();

		// Determine type based on content
		let type: 'fact' | 'pattern' | 'solution' | 'guideline' = 'fact';
		if (lowerKnowledge.includes('pattern') || lowerKnowledge.includes('use')) {
			type = 'pattern';
		} else if (lowerKnowledge.includes('solution') || lowerKnowledge.includes('implement')) {
			type = 'solution';
		} else if (lowerKnowledge.includes('guideline') || lowerKnowledge.includes('best practice')) {
			type = 'guideline';
		}

		// Calculate confidence based on content quality
		let confidence = 0.5; // Base confidence

		// Increase confidence for specific indicators
		if (lowerKnowledge.includes('proven') || lowerKnowledge.includes('tested')) {
			confidence += 0.2;
		}
		if (lowerKnowledge.includes('recommended') || lowerKnowledge.includes('best')) {
			confidence += 0.1;
		}
		if (knowledge.length > 50 && knowledge.length < 200) {
			confidence += 0.1; // Good length
		}

		// Calculate relevance based on technical content
		let relevance = 0.5; // Base relevance

		const technicalTerms = [
			'api',
			'database',
			'frontend',
			'backend',
			'component',
			'function',
			'class',
			'method',
			'variable',
			'interface',
			'type',
			'error',
		];

		const technicalTermCount = technicalTerms.filter(term => lowerKnowledge.includes(term)).length;

		relevance += Math.min(technicalTermCount * 0.1, 0.3);

		return {
			type,
			confidence: Math.min(confidence, 1.0),
			relevance: Math.min(relevance, 1.0),
		};
	}

	/**
	 * Check if master guides should be generated for a domain
	 */
	private async checkAndGenerateMasterGuides(domain: string): Promise<void> {
		try {
			const domainProjects = this.crossProjectManager
				.getAllProjects()
				.filter(p => p.domain === domain);

			if (domainProjects.length >= this.config.masterGuideGenerationThreshold) {
				const existingGuides = this.crossProjectManager.getMasterGuidesByDomain(domain);

				if (existingGuides.length === 0) {
					// Generate new master guide
					await this.crossProjectManager.generateMasterGuide(domain);
					logger.info('Auto-generated master guide for domain', { domain });
				}
			}
		} catch (error) {
			logger.warn('Failed to check and generate master guides', {
				domain,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	/**
	 * Attempt to extract knowledge from a project
	 */
	private async attemptKnowledgeExtraction(projectId: string): Promise<void> {
		try {
			// This would typically extract knowledge from project files, commits, etc.
			// For now, we'll just log the attempt
			logger.debug('Attempting knowledge extraction for project', { projectId });

			// In a real implementation, this would:
			// 1. Scan project files for patterns, solutions, etc.
			// 2. Extract knowledge from commit messages
			// 3. Analyze code comments and documentation
			// 4. Extract knowledge from test files
		} catch (error) {
			logger.warn('Failed to extract knowledge from project', {
				projectId,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	/**
	 * Shutdown the memory integration system
	 */
	async shutdown(): Promise<void> {
		try {
			logger.info('Shutting down memory integration system');

			if (this.projectDetectionTimer) {
				clearInterval(this.projectDetectionTimer);
    this.projectDetectionTimer = undefined as any;
			}

			await this.crossProjectManager.shutdown();
			this.isRunning = false;
			this.registeredProjects.clear();

			this.emit('shutdown');
			logger.info('Memory integration system shutdown complete');
		} catch (error) {
			logger.error('Error during memory integration shutdown', {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}
}
