/**
 * Cross-Project Knowledge Transfer Manager
 *
 * Main orchestrator for cross-project knowledge transfer functionality.
 * Integrates with existing memory tools and provides automatic knowledge sharing.
 */

import { EventEmitter } from 'events';
import { logger } from '../index.js';
import { ProjectRegistryManager } from './project-registry.js';
import { KnowledgeSynthesizer } from './knowledge-synthesizer.js';
import { MasterGuideEngine } from './master-guide-engine.js';
import type {
	ProjectKnowledge,
	KnowledgeTransfer,
	MasterGuide,
	CrossProjectConfig,
	CrossProjectMetrics,
	KnowledgeSynthesisResult,
} from './types.js';

export interface CrossProjectManagerConfig extends CrossProjectConfig {
	enableAutoTransfer: boolean;
	enableMasterGuide: boolean;
	enablePerformanceMonitoring: boolean;
	maxConcurrentTransfers: number;
	transferBatchSize: number;
}

export class CrossProjectManager extends EventEmitter {
	private projectRegistry: ProjectRegistryManager;
	private synthesizer: KnowledgeSynthesizer;
	private masterGuideEngine: MasterGuideEngine;
	private config: CrossProjectManagerConfig;
	private isRunning = false;

	constructor(config: Partial<CrossProjectManagerConfig> = {}) {
		super();

		this.config = {
			enableAutoTransfer: true,
			enableMasterGuide: true,
			enablePerformanceMonitoring: true,
			maxConcurrentTransfers: 5,
			transferBatchSize: 10,
			similarityThreshold: 0.7,
			maxTransferPerProject: 100,
			updateInterval: 60 * 60 * 1000, // 1 hour
			masterGuideUpdateInterval: 24 * 60 * 60 * 1000, // 24 hours
			knowledgeRetentionDays: 30,
			...config,
		};

		this.projectRegistry = new ProjectRegistryManager(this.config);
		this.synthesizer = new KnowledgeSynthesizer();
		this.masterGuideEngine = new MasterGuideEngine({
			enableAutoGeneration: this.config.enableMasterGuide,
			updateInterval: this.config.masterGuideUpdateInterval,
		});

		this.setupEventHandlers();
	}

	/**
	 * Initialize the cross-project knowledge transfer system
	 */
	async initialize(): Promise<void> {
		try {
			logger.info('Initializing cross-project knowledge transfer system', {
				config: {
					enableAutoTransfer: this.config.enableAutoTransfer,
					enableMasterGuide: this.config.enableMasterGuide,
					similarityThreshold: this.config.similarityThreshold,
				},
			});

			// Start auto-updates if enabled
			if (this.config.enableAutoTransfer) {
				this.projectRegistry.startAutoUpdates();
			}

			if (this.config.enableMasterGuide) {
				this.masterGuideEngine.startAutoGeneration();
			}

			this.isRunning = true;
			this.emit('initialized');

			logger.info('Cross-project knowledge transfer system initialized successfully');
		} catch (error) {
			logger.error('Failed to initialize cross-project knowledge transfer system', {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Register a project for cross-project knowledge transfer
	 */
	async registerProject(
		project: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'>
	): Promise<void> {
		await this.projectRegistry.registerProject(project);
	}

	/**
	 * Transfer knowledge between projects
	 */
	async transferKnowledge(
		sourceProjectId: string,
		targetProjectId: string,
		knowledge: string,
		knowledgeType: 'fact' | 'pattern' | 'solution' | 'guideline',
		confidence: number = 0.8,
		relevance: number = 0.8
	): Promise<string> {
		try {
			const transferId = await this.projectRegistry.transferKnowledge({
				sourceProjectId,
				targetProjectId,
				knowledgeType,
				content: knowledge,
				confidence,
				relevance,
				metadata: {
					transferredBy: 'cross-project-manager',
					timestamp: new Date().toISOString(),
				},
			});

			// Trigger automatic master guide updates if enabled
			if (this.config.enableMasterGuide) {
				this.emit('knowledgeTransferred', { transferId, sourceProjectId, targetProjectId });
			}

			return transferId;
		} catch (error) {
			logger.error('Failed to transfer knowledge', {
				sourceProjectId,
				targetProjectId,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Generate master guide for a domain
	 */
	async generateMasterGuide(domain: string, title?: string): Promise<MasterGuide> {
		try {
			const projects = this.projectRegistry.getProjects();
			const transfers = Array.from(this.projectRegistry['registry'].transfers.values());

			return await this.masterGuideEngine.generateMasterGuide(domain, projects, transfers, title);
		} catch (error) {
			logger.error('Failed to generate master guide', {
				domain,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Get master guide by ID
	 */
	getMasterGuide(guideId: string): MasterGuide | undefined {
		return this.masterGuideEngine.getMasterGuide(guideId);
	}

	/**
	 * Get all master guides
	 */
	getAllMasterGuides(): MasterGuide[] {
		return this.masterGuideEngine.getAllMasterGuides();
	}

	/**
	 * Search master guides
	 */
	searchMasterGuides(query: string): MasterGuide[] {
		return this.masterGuideEngine.searchMasterGuides(query);
	}

	/**
	 * Synthesize knowledge across projects
	 */
	async synthesizeKnowledge(domain?: string): Promise<KnowledgeSynthesisResult> {
		try {
			const projects = this.projectRegistry.getProjects();
			const transfers = Array.from(this.projectRegistry['registry'].transfers.values());

			return await this.synthesizer.synthesizeKnowledge(projects, transfers, domain);
		} catch (error) {
			logger.error('Failed to synthesize knowledge', {
				domain,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Get cross-project metrics
	 */
	getMetrics(): CrossProjectMetrics {
		const registryMetrics = this.projectRegistry.getMetrics();
		const guideStats = this.masterGuideEngine.getStatistics();

		return {
			...registryMetrics,
			totalMasterGuides: guideStats.totalGuides,
			performanceMetrics: {
				...registryMetrics.performanceMetrics,
				averageSynthesisTime: registryMetrics.performanceMetrics.averageSynthesisTime,
			},
		};
	}

	/**
	 * Get project by ID
	 */
	getProject(projectId: string): ProjectKnowledge | undefined {
		return this.projectRegistry.getProject(projectId);
	}

	/**
	 * Get all projects
	 */
	getAllProjects(): ProjectKnowledge[] {
		return this.projectRegistry.getProjects();
	}

	/**
	 * Get master guides by domain
	 */
	getMasterGuidesByDomain(domain: string): MasterGuide[] {
		return this.masterGuideEngine.getGuidesByDomain(domain);
	}

	/**
	 * Get knowledge transfers for a project
	 */
	getProjectTransfers(projectId: string): KnowledgeTransfer[] {
		return this.projectRegistry.getProjectTransfers(projectId);
	}

	/**
	 * Update project knowledge count
	 */
	async updateProjectKnowledge(
		projectId: string,
		knowledgeCount: number,
		metadata?: Record<string, any>
	): Promise<void> {
		await this.projectRegistry.updateProjectKnowledge(projectId, knowledgeCount, metadata);
	}

	/**
	 * Setup event handlers
	 */
	private setupEventHandlers(): void {
		this.projectRegistry.on('projectRegistered', project => {
			this.emit('projectRegistered', project);
		});

		this.projectRegistry.on('knowledgeTransferred', transfer => {
			this.emit('knowledgeTransferred', transfer);
		});

		this.masterGuideEngine.on('masterGuideGenerated', guide => {
			this.emit('masterGuideGenerated', guide);
		});

		this.masterGuideEngine.on('masterGuideUpdated', guide => {
			this.emit('masterGuideUpdated', guide);
		});

		// Auto-trigger master guide updates when knowledge is transferred
		this.on('knowledgeTransferred', async data => {
			if (this.config.enableMasterGuide) {
				try {
					const sourceProject = this.getProject(data.sourceProjectId);
					const targetProject = this.getProject(data.targetProjectId);

					if (sourceProject && targetProject) {
						// Update master guides for both domains
						await this.updateMasterGuidesForDomain(sourceProject.domain);
						if (sourceProject.domain !== targetProject.domain) {
							await this.updateMasterGuidesForDomain(targetProject.domain);
						}
					}
				} catch (error) {
					logger.warn('Failed to auto-update master guides after knowledge transfer', {
						error: error instanceof Error ? error.message : 'Unknown error',
					});
				}
			}
		});
	}

	/**
	 * Update master guides for a specific domain
	 */
	private async updateMasterGuidesForDomain(domain: string): Promise<void> {
		try {
			const existingGuides = this.masterGuideEngine.getMasterGuidesByDomain(domain);

			for (const guide of existingGuides) {
				const projects = this.projectRegistry.getProjects();
				const transfers = Array.from(
      Array.from(this.projectRegistry['registry'].transfers.values())
				);

				await this.masterGuideEngine.updateMasterGuide(guide.id, projects, transfers);
			}
		} catch (error) {
			logger.warn('Failed to update master guides for domain', {
				domain,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	/**
	 * Shutdown the cross-project knowledge transfer system
	 */
	async shutdown(): Promise<void> {
		try {
			logger.info('Shutting down cross-project knowledge transfer system');

			this.projectRegistry.stopAutoUpdates();
			this.masterGuideEngine.stopAutoGeneration();
			this.isRunning = false;

			this.emit('shutdown');
			logger.info('Cross-project knowledge transfer system shutdown complete');
		} catch (error) {
			logger.error('Error during shutdown', {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	/**
	 * Check if the system is running
	 */
	isSystemRunning(): boolean {
		return this.isRunning;
	}

	/**
	 * Get system status
	 */
	getSystemStatus(): {
		isRunning: boolean;
		config: CrossProjectManagerConfig;
		metrics: CrossProjectMetrics;
		guideStats: any;
	} {
		return {
			isRunning: this.isRunning,
			config: this.config,
			metrics: this.getMetrics(),
			guideStats: this.masterGuideEngine.getStatistics(),
		};
	}
}
