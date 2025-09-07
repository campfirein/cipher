/**
 * Project Registry for Cross-Project Knowledge Transfer
 *
 * Manages project registration, knowledge tracking, and cross-project
 * knowledge transfer coordination.
 */

import { EventEmitter } from 'events';
import { logger } from '../index.js';
import type {
	ProjectKnowledge,
	KnowledgeTransfer,
	MasterGuide,
	ProjectRegistry,
	CrossProjectConfig,
	CrossProjectMetrics,
} from './types.js';

export class ProjectRegistryManager extends EventEmitter {
	private registry: ProjectRegistry;
	private config: CrossProjectConfig;
	private metrics: CrossProjectMetrics;
	private updateTimer?: NodeJS.Timeout;
	private masterGuideTimer?: NodeJS.Timeout;

	constructor(config: CrossProjectConfig) {
		super();
		this.config = config;
		this.registry = {
			projects: new Map(),
			transfers: new Map(),
			masterGuides: new Map(),
			lastSync: new Date(),
		};
		this.metrics = {
			totalProjects: 0,
			totalTransfers: 0,
			totalMasterGuides: 0,
			averageConfidence: 0,
			lastUpdate: new Date(),
			performanceMetrics: {
				averageTransferTime: 0,
				averageSynthesisTime: 0,
				cacheHitRate: 0,
			},
		};
	}

	/**
	 * Register a new project in the cross-project knowledge system
	 */
	async registerProject(
		project: Omit<ProjectKnowledge, 'lastUpdated' | 'knowledgeCount'>
	): Promise<void> {
		const startTime = Date.now();

		try {
			const projectKnowledge: ProjectKnowledge = {
				...project,
				lastUpdated: new Date(),
				knowledgeCount: 0,
			};

			this.registry.projects.set(project.projectId, projectKnowledge);
			this.metrics.totalProjects = this.registry.projects.size;
			this.metrics.lastUpdate = new Date();

			logger.info('Project registered for cross-project knowledge transfer', {
				projectId: project.projectId,
				projectName: project.projectName,
				domain: project.domain,
			});

			this.emit('projectRegistered', projectKnowledge);

			const transferTime = Date.now() - startTime;
			this.updatePerformanceMetrics('averageTransferTime', transferTime);
		} catch (error) {
			logger.error('Failed to register project', {
				projectId: project.projectId,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Update project knowledge count and metadata
	 */
	async updateProjectKnowledge(
		projectId: string,
		knowledgeCount: number,
		metadata?: Record<string, any>
	): Promise<void> {
		const project = this.registry.projects.get(projectId);
		if (!project) {
			throw new Error(`Project ${projectId} not found`);
		}

		project.knowledgeCount = knowledgeCount;
		project.lastUpdated = new Date();
		if (metadata) {
			project.metadata = { ...project.metadata, ...metadata };
		}

		this.emit('projectUpdated', project);
	}

	/**
	 * Transfer knowledge between projects
	 */
	async transferKnowledge(
		transfer: Omit<KnowledgeTransfer, 'id' | 'transferredAt'>
	): Promise<string> {
		const startTime = Date.now();

		try {
			// Validate source and target projects exist
			if (!this.registry.projects.has(transfer.sourceProjectId)) {
				throw new Error(`Source project ${transfer.sourceProjectId} not found`);
			}
			if (!this.registry.projects.has(transfer.targetProjectId)) {
				throw new Error(`Target project ${transfer.targetProjectId} not found`);
			}

			const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
			const knowledgeTransfer: KnowledgeTransfer = {
				...transfer,
				id: transferId,
				transferredAt: new Date(),
			};

			this.registry.transfers.set(transferId, knowledgeTransfer);
			this.metrics.totalTransfers = this.registry.transfers.size;

			logger.info('Knowledge transferred between projects', {
				transferId,
				sourceProject: transfer.sourceProjectId,
				targetProject: transfer.targetProjectId,
				knowledgeType: transfer.knowledgeType,
				confidence: transfer.confidence,
			});

			this.emit('knowledgeTransferred', knowledgeTransfer);

			const transferTime = Date.now() - startTime;
			this.updatePerformanceMetrics('averageTransferTime', transferTime);

			return transferId;
		} catch (error) {
			logger.error('Failed to transfer knowledge', {
				sourceProject: transfer.sourceProjectId,
				targetProject: transfer.targetProjectId,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Create or update a master guide
	 */
	async createMasterGuide(
		guide: Omit<MasterGuide, 'id' | 'lastUpdated' | 'version'>
	): Promise<string> {
		const startTime = Date.now();

		try {
			const guideId = `guide_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
			const masterGuide: MasterGuide = {
				...guide,
				id: guideId,
				lastUpdated: new Date(),
				version: '1.0.0',
			};

			this.registry.masterGuides.set(guideId, masterGuide);
			this.metrics.totalMasterGuides = this.registry.masterGuides.size;

			logger.info('Master guide created', {
				guideId,
				title: guide.title,
				domain: guide.domain,
				knowledgeSources: guide.knowledgeSources.length,
			});

			this.emit('masterGuideCreated', masterGuide);

			const synthesisTime = Date.now() - startTime;
			this.updatePerformanceMetrics('averageSynthesisTime', synthesisTime);

			return guideId;
		} catch (error) {
			logger.error('Failed to create master guide', {
				title: guide.title,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
			throw error;
		}
	}

	/**
	 * Get all projects
	 */
	getProjects(): ProjectKnowledge[] {
		return Array.from(this.registry.projects.values());
	}

	/**
	 * Get project by ID
	 */
	getProject(projectId: string): ProjectKnowledge | undefined {
		return this.registry.projects.get(projectId);
	}

	/**
	 * Get knowledge transfers for a project
	 */
	getProjectTransfers(projectId: string): KnowledgeTransfer[] {
		return Array.from(this.registry.transfers.values()).filter(
			transfer => transfer.sourceProjectId === projectId || transfer.targetProjectId === projectId
		);
	}

	/**
	 * Get master guides by domain
	 */
	getMasterGuidesByDomain(domain: string): MasterGuide[] {
		return Array.from(this.registry.masterGuides.values()).filter(guide => guide.domain === domain);
	}

	/**
	 * Get all master guides
	 */
	getMasterGuides(): MasterGuide[] {
		return Array.from(this.registry.masterGuides.values());
	}

	/**
	 * Get cross-project metrics
	 */
	getMetrics(): CrossProjectMetrics {
		return { ...this.metrics };
	}

	/**
	 * Start automatic updates
	 */
	startAutoUpdates(): void {
		if (this.updateTimer) {
			clearInterval(this.updateTimer);
		}
		if (this.masterGuideTimer) {
			clearInterval(this.masterGuideTimer);
		}

		this.updateTimer = setInterval(() => {
			this.performAutoUpdate();
		}, this.config.updateInterval);

		if (this.config.enableMasterGuide) {
			this.masterGuideTimer = setInterval(() => {
				this.updateMasterGuides();
			}, this.config.masterGuideUpdateInterval);
		}

		logger.info('Cross-project knowledge auto-updates started', {
			updateInterval: this.config.updateInterval,
			masterGuideUpdateInterval: this.config.masterGuideUpdateInterval,
		});
	}

	/**
	 * Stop automatic updates
	 */
	stopAutoUpdates(): void {
		if (this.updateTimer) {
			clearInterval(this.updateTimer);
   this.updateTimer = undefined as any;
		}
		if (this.masterGuideTimer) {
			clearInterval(this.masterGuideTimer);
   this.masterGuideTimer = undefined as any;
		}

		logger.info('Cross-project knowledge auto-updates stopped');
	}

	/**
	 * Perform automatic knowledge updates
	 */
	private async performAutoUpdate(): Promise<void> {
		try {
			// Clean up old transfers based on retention policy
			const cutoffDate = new Date(
				Date.now() - this.config.knowledgeRetentionDays * 24 * 60 * 60 * 1000
			);
			const oldTransfers = Array.from(this.registry.transfers.values()).filter(
				transfer => transfer.transferredAt < cutoffDate
			);

			for (const transfer of oldTransfers) {
				this.registry.transfers.delete(transfer.id);
			}

			if (oldTransfers.length > 0) {
				logger.debug('Cleaned up old knowledge transfers', {
					removedCount: oldTransfers.length,
					cutoffDate: cutoffDate.toISOString(),
				});
			}

			this.emit('autoUpdateCompleted', {
				removedTransfers: oldTransfers.length,
				timestamp: new Date(),
			});
		} catch (error) {
			logger.error('Auto-update failed', {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	/**
	 * Update master guides based on new knowledge
	 */
	private async updateMasterGuides(): Promise<void> {
		try {
			// This would typically involve analyzing new knowledge and updating guides
			// For now, we'll just emit an event for external processing
			this.emit('masterGuideUpdateRequired', {
				timestamp: new Date(),
				projectCount: this.registry.projects.size,
			});
		} catch (error) {
			logger.error('Master guide update failed', {
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	/**
	 * Update performance metrics
	 */
	private updatePerformanceMetrics(
		metric: keyof CrossProjectMetrics['performanceMetrics'],
		value: number
	): void {
		const current = this.metrics.performanceMetrics[metric];
		this.metrics.performanceMetrics[metric] = (current + value) / 2; // Simple moving average
	}

	/**
	 * Cleanup resources
	 */
	destroy(): void {
		this.stopAutoUpdates();
		this.removeAllListeners();
		this.registry.projects.clear();
		this.registry.transfers.clear();
		this.registry.masterGuides.clear();
	}
}
