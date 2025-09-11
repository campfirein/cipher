/**
 * Cross-Project Knowledge Transfer Manager - Main orchestrator
 * 
 * Coordinates knowledge sharing between projects by managing project registry,
 * knowledge synthesis, and master guide generation. Provides unified API
 * for cross-project operations while maintaining component separation.
 * 
 * Why this exists: Teams work on similar problems in isolation. This manager
 * enables automatic knowledge sharing to reduce duplicate work and improve
 * team efficiency across multiple projects.
 */

import { EventEmitter } from 'events';
import { logger } from '../index.js';
import { ProjectRegistryManager } from './project-registry.js';
import { KnowledgeSynthesizer } from './knowledge-synthesizer.js';
import { MasterGuideEngine } from './master-guide-engine.js';
import { loadCrossProjectConfig, validateCrossProjectConfig } from './cross-project-config.js';
import { ServiceEvents } from '../events/event-types.js';
import type {
	ProjectKnowledge,
	KnowledgeTransfer,
	MasterGuide,
	CrossProjectConfig,
	CrossProjectMetrics,
	KnowledgeSynthesisResult,
} from './types.js';

/**
 * Configuration for cross-project manager behavior
 * 
 * Controls feature enablement, performance limits, and system behavior
 * to balance functionality with resource usage.
 */
export interface CrossProjectManagerConfig extends CrossProjectConfig {
	/** Enable automatic knowledge sharing between projects */
	enableAutoTransfer: boolean;
	/** Enable master guide generation and updates */
	enableMasterGuide: boolean;
	/** Enable performance monitoring and metrics */
	enablePerformanceMonitoring: boolean;
	/** Max concurrent transfers to prevent resource overload */
	maxConcurrentTransfers: number;
	/** Batch size for processing transfers efficiently */
	transferBatchSize: number;
}

/**
 * Main class for coordinating cross-project knowledge operations
 * 
 * Provides unified API for project management, knowledge transfer,
 * and master guide generation across multiple projects.
 */
export class CrossProjectManager extends EventEmitter {
	private projectRegistry: ProjectRegistryManager;
	private synthesizer: KnowledgeSynthesizer;
	private masterGuideEngine: MasterGuideEngine;
	private config: CrossProjectManagerConfig;
	private isRunning = false;
	private eventManager?: any;

	/**
	 * Creates manager with configuration from environment variables
	 * 
	 * @param config - Optional partial config to override environment settings
	 * 
	 * Loads configuration from environment variables with sensible defaults.
	 * Can be overridden with partial config for testing or custom setups.
	 */
	constructor(config: Partial<CrossProjectManagerConfig> = {}) {
		super();

		// Load configuration from environment variables
		const envConfig = loadCrossProjectConfig();
		
		// Validate configuration
		if (!validateCrossProjectConfig(envConfig)) {
			throw new Error('Invalid cross-project knowledge configuration');
		}

		// Merge environment config with provided overrides
		this.config = {
			...envConfig.crossProjectManagerConfig,
			...config,
		};

		// Initialize components with environment-based configuration
		this.projectRegistry = new ProjectRegistryManager(this.config);
		this.synthesizer = new KnowledgeSynthesizer(envConfig.synthesisOptions);
		this.masterGuideEngine = new MasterGuideEngine({
			...envConfig.masterGuideConfig,
			enableAutoGeneration: this.config.enableMasterGuide,
		});

		this.setupEventHandlers();
	}

	/**
	 * Starts the system and enables background services
	 * 
	 * @returns Promise<void> - Resolves when ready for operations
	 * @throws Error if initialization fails
	 * 
	 * Must be called before using any cross-project functionality.
	 * Safe to call multiple times (idempotent).
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

			// Start background services if enabled
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
	 * Transfers knowledge between projects
	 * 
	 * @param sourceProjectId - Project providing knowledge
	 * @param targetProjectId - Project receiving knowledge
	 * @param knowledge - Knowledge content to transfer
	 * @param knowledgeType - Type: 'fact', 'pattern', 'solution', or 'guideline'
	 * @param confidence - Quality score (0-1, default: 0.8)
	 * @param relevance - Relevance to target project (0-1, default: 0.8)
	 * @returns Transfer ID for tracking
	 * @throws Error if projects don't exist or transfer fails
	 */
	async transferKnowledge(
		sourceProjectId: string,
		targetProjectId: string,
		knowledge: string,
		knowledgeType: 'fact' | 'pattern' | 'solution' | 'guideline',
		confidence: number = 0.8,
		relevance: number = 0.8
	): Promise<string> {
		const startTime = Date.now();

		// Emit transfer started event
		this.emitServiceEvent(ServiceEvents.CROSS_PROJECT_TRANSFER_STARTED, {
			sourceProject: sourceProjectId,
			targetProject: targetProjectId,
			knowledgeTypes: [knowledgeType],
			timestamp: startTime,
		});

		try {
			// Create transfer record - registry handles validation
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

			// Emit transfer completed event
			this.emitServiceEvent(ServiceEvents.CROSS_PROJECT_TRANSFER_COMPLETED, {
				sourceProject: sourceProjectId,
				targetProject: targetProjectId,
				knowledgeTypes: [knowledgeType],
				transferredCount: 1,
				duration: Date.now() - startTime,
				timestamp: Date.now(),
			});

			// Trigger master guide updates if enabled
			if (this.config.enableMasterGuide) {
				this.emit('knowledgeTransferred', { transferId, sourceProjectId, targetProjectId });
			}

			return transferId;
		} catch (error) {
			// Emit transfer failed event
			this.emitServiceEvent(ServiceEvents.CROSS_PROJECT_TRANSFER_FAILED, {
				sourceProject: sourceProjectId,
				targetProject: targetProjectId,
				knowledgeTypes: [knowledgeType],
				error: error instanceof Error ? error.message : 'Unknown error',
				duration: Date.now() - startTime,
				timestamp: Date.now(),
			});

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
	 * Setup event handlers for component communication
	 * 
	 * This method establishes the event-driven communication pattern between
	 * different system components. It acts as an event bridge, forwarding
	 * events from internal components to external listeners and implementing
	 * automatic behaviors based on system events.
	 * 
	 * Event Flow Architecture:
	 * 1. Internal components emit events (projectRegistry, masterGuideEngine)
	 * 2. Manager forwards events to external listeners
	 * 3. Manager implements automatic behaviors based on events
	 * 4. External systems can listen to manager events for integration
	 * 
	 * Automatic Behaviors:
	 * - Master guide auto-updates when knowledge is transferred
	 * - Cross-domain guide updates for multi-domain transfers
	 * - Error handling and logging for failed operations
	 * 
	 * Event Types:
	 * - 'projectRegistered': When a new project is registered
	 * - 'knowledgeTransferred': When knowledge is transferred between projects
	 * - 'masterGuideGenerated': When a new master guide is created
	 * - 'masterGuideUpdated': When an existing master guide is updated
	 * 
	 * This event-driven approach enables loose coupling between components
	 * and allows external systems to integrate with the cross-project system
	 * without tight coupling to internal implementation details.
	 */
	private setupEventHandlers(): void {
		// Forward project registration events to external listeners
		this.projectRegistry.on('projectRegistered', project => {
			this.emit('projectRegistered', project);
		});

		// Forward knowledge transfer events to external listeners
		this.projectRegistry.on('knowledgeTransferred', transfer => {
			this.emit('knowledgeTransferred', transfer);
		});

		// Forward master guide generation events to external listeners
		this.masterGuideEngine.on('masterGuideGenerated', guide => {
			this.emit('masterGuideGenerated', guide);
		});

		// Forward master guide update events to external listeners
		this.masterGuideEngine.on('masterGuideUpdated', guide => {
			this.emit('masterGuideUpdated', guide);
		});

		// Implement automatic master guide updates when knowledge is transferred
		// This ensures guides stay current with the latest knowledge
		this.on('knowledgeTransferred', async data => {
			if (this.config.enableMasterGuide) {
				try {
					// Get source and target project information
					const sourceProject = this.getProject(data.sourceProjectId);
					const targetProject = this.getProject(data.targetProjectId);

					if (sourceProject && targetProject) {
						// Update master guides for the source project's domain
						await this.updateMasterGuidesForDomain(sourceProject.domain);
						
						// If projects are in different domains, update target domain too
						if (sourceProject.domain !== targetProject.domain) {
							await this.updateMasterGuidesForDomain(targetProject.domain);
						}
					}
				} catch (error) {
					// Log warning but don't fail the transfer
					// Guide updates are important but not critical for transfers
					logger.warn('Failed to auto-update master guides after knowledge transfer', {
						error: error instanceof Error ? error.message : 'Unknown error',
					});
				}
			}
		});
	}

	/**
	 * Set event manager for cross-project knowledge events
	 * 
	 * @param eventManager - Event manager instance
	 */
	setEventManager(eventManager: any): void {
		this.eventManager = eventManager;
	}

	/**
	 * Emit service event for cross-project knowledge system
	 * 
	 * @param eventType - Type of event to emit
	 * @param data - Event data
	 */
	private emitServiceEvent(eventType: string, data: any): void {
		// Emit to internal event emitter
		this.emit(eventType, data);

		// If event manager is available, emit to service event bus
		if (this.eventManager) {
			this.eventManager.emitServiceEvent(eventType, data);
		}
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
