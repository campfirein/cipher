/**
 * Memory Integration - Connects cross-project knowledge with existing memory tools
 *
 * Automatically detects projects, extracts knowledge, and enables sharing
 * between projects using the existing memory system infrastructure.
 *
 * Why this exists: Manual knowledge sharing is time-consuming and error-prone.
 * This integration automates the process by detecting projects and extracting
 * valuable knowledge for cross-project sharing.
 */

import { EventEmitter } from 'events';
import { logger } from '../index.js';
import { CrossProjectManager } from './cross-project-manager.js';
import { loadCrossProjectConfig, validateCrossProjectConfig } from './cross-project-config.js';
import type { ProjectKnowledge, MasterGuide, CrossProjectConfig } from './types.js';

/**
 * Configuration for memory integration behavior
 *
 * Controls automatic detection, extraction, and generation features
 * to balance automation with resource usage.
 */
export interface MemoryIntegrationConfig extends CrossProjectConfig {
	/** Enable automatic project detection from memory system */
	enableAutoProjectDetection: boolean;
	/** Enable automatic knowledge extraction from memory */
	enableAutoKnowledgeExtraction: boolean;
	/** Enable automatic master guide generation */
	enableAutoMasterGuideGeneration: boolean;
	/** How often to scan for new projects (milliseconds) */
	projectDetectionInterval: number;
	/** Minimum confidence for auto-extracting knowledge (0-1) */
	knowledgeExtractionThreshold: number;
	/** Minimum projects needed for auto-generating master guides */
	masterGuideGenerationThreshold: number;
}

/**
 * Manages integration between memory system and cross-project knowledge
 *
 * Automatically detects projects, extracts knowledge, and coordinates
 * cross-project sharing using the existing memory infrastructure.
 */
export class MemoryIntegrationManager extends EventEmitter {
	private crossProjectManager: CrossProjectManager;
	private config: MemoryIntegrationConfig;
	private isRunning = false;
	private projectDetectionTimer?: NodeJS.Timeout;
	private registeredProjects = new Set<string>();
	private eventManager?: any;

	/**
	 * Creates integration manager with configuration from environment variables
	 *
	 * @param config - Optional partial config to override environment settings
	 *
	 * Loads configuration from environment variables with sensible defaults.
	 * Can be overridden with partial config for testing or custom setups.
	 */
	constructor(config: Partial<MemoryIntegrationConfig> = {}) {
		super();

		// Load configuration from environment variables
		const envConfig = loadCrossProjectConfig();

		// Validate configuration
		if (!validateCrossProjectConfig(envConfig)) {
			throw new Error('Invalid cross-project knowledge configuration');
		}

		// Merge environment config with provided overrides
		this.config = {
			...envConfig.memoryIntegrationConfig,
			...config,
		};

		// Initialize cross-project manager with environment-based configuration
		this.crossProjectManager = new CrossProjectManager(envConfig.crossProjectManagerConfig);
		this.setupEventHandlers();
	}

	/**
	 * Starts the integration system and enables auto-detection
	 *
	 * @returns Promise<void> - Resolves when ready for operations
	 * @throws Error if initialization fails
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

			// Start auto-detection if enabled
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
	 * Set event manager for emitting service-level events
	 */
	setEventManager(eventManager: any): void {
		this.eventManager = eventManager;
	}

	/**
	 * Registers project and extracts existing knowledge automatically
	 *
	 * @param project - Project to register
	 * @param existingKnowledge - Optional existing knowledge to extract
	 * @returns Promise<void> - Resolves when registration complete
	 * @throws Error if registration or extraction fails
	 */
	async registerProjectWithAutoExtraction(
		project: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'>,
		existingKnowledge?: string[]
	): Promise<void> {
		try {
			await this.crossProjectManager.registerProject(project);
			this.registeredProjects.add(project.projectId);

			// Extract existing knowledge if provided
			if (existingKnowledge && existingKnowledge.length > 0) {
				await this.extractAndTransferKnowledge(project.projectId, existingKnowledge);
			}

			// Generate master guides if enabled
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
	 * Extracts knowledge from project and transfers to other projects in same domain
	 *
	 * @param projectId - Source project ID
	 * @param knowledgeItems - Knowledge items to extract and transfer
	 * @returns Array of transfer IDs created
	 * @throws Error if project not found or transfer fails
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

			// Find other projects in same domain
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

			// Process each knowledge item
			for (const knowledge of knowledgeItems) {
				if (this.shouldExtractKnowledge(knowledge)) {
					const { type, confidence, relevance } = this.analyzeKnowledge(knowledge);

					// Transfer to other projects in same domain
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
