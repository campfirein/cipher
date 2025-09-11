/**
 * Cross-Project Knowledge API Routes
 * 
 * Provides REST API endpoints for cross-project knowledge management.
 * Includes status, health, manual triggers, and configuration endpoints.
 * 
 * Why this exists: Users need programmatic access to cross-project knowledge
 * features for monitoring, debugging, and manual control.
 */

import { Router, Request, Response } from 'express';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { logger } from '@core/logger/index.js';
import { env } from '@core/env.js';
import type { AgentServices } from '@core/utils/service-initializer.js';

export function createCrossProjectRoutes(agentServices: AgentServices): Router {
	const router = Router();

	/**
	 * GET /api/cross-project/status
	 * Get cross-project knowledge system status
	 */
	router.get('/status', async (req: Request, res: Response) => {
		try {
			logger.info('Getting cross-project knowledge status', { requestId: req.requestId });

			const isEnabled = env.CIPHER_CROSS_PROJECT_ENABLED;
			const crossProjectManager = agentServices.crossProjectManager;
			const memoryIntegrationManager = agentServices.memoryIntegrationManager;

			if (!isEnabled) {
				successResponse(
					res,
					{
						enabled: false,
						message: 'Cross-project knowledge system is disabled',
						timestamp: new Date().toISOString(),
					},
					200,
					req.requestId
				);
				return;
			}

			if (!crossProjectManager || !memoryIntegrationManager) {
				errorResponse(
					res,
					ERROR_CODES.SERVICE_UNAVAILABLE,
					'Cross-project knowledge services not initialized',
					503,
					undefined,
					req.requestId
				);
				return;
			}

			// Get system status
			const status = {
				enabled: true,
				services: {
					crossProjectManager: !!crossProjectManager,
					memoryIntegrationManager: !!memoryIntegrationManager,
				},
				configuration: {
					autoTransfer: env.CIPHER_CROSS_PROJECT_AUTO_TRANSFER,
					masterGuides: env.CIPHER_CROSS_PROJECT_MASTER_GUIDES,
					performanceMonitoring: env.CIPHER_CROSS_PROJECT_PERFORMANCE_MONITORING,
					similarityThreshold: env.CIPHER_CROSS_PROJECT_SIMILARITY_THRESHOLD,
					maxConcurrentTransfers: env.CIPHER_CROSS_PROJECT_MAX_CONCURRENT_TRANSFERS,
					updateInterval: env.CIPHER_CROSS_PROJECT_UPDATE_INTERVAL,
				},
				timestamp: new Date().toISOString(),
			};

			successResponse(res, status, 200, req.requestId);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get cross-project knowledge status', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to get status: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/cross-project/health
	 * Get detailed health information for cross-project knowledge system
	 */
	router.get('/health', async (req: Request, res: Response) => {
		try {
			logger.info('Getting cross-project knowledge health', { requestId: req.requestId });

			const isEnabled = env.CIPHER_CROSS_PROJECT_ENABLED;
			const crossProjectManager = agentServices.crossProjectManager;
			const memoryIntegrationManager = agentServices.memoryIntegrationManager;

			if (!isEnabled) {
				successResponse(
					res,
					{
						healthy: true,
						status: 'disabled',
						message: 'Cross-project knowledge system is disabled',
						timestamp: new Date().toISOString(),
					},
					200,
					req.requestId
				);
				return;
			}

			if (!crossProjectManager || !memoryIntegrationManager) {
				successResponse(
					res,
					{
						healthy: false,
						status: 'unavailable',
						message: 'Cross-project knowledge services not initialized',
						timestamp: new Date().toISOString(),
					},
					503,
					req.requestId
				);
				return;
			}

			// Get health information
			const health = {
				healthy: true,
				status: 'running',
				services: {
					crossProjectManager: {
						available: !!crossProjectManager,
						// Add more detailed health checks here if needed
					},
					memoryIntegrationManager: {
						available: !!memoryIntegrationManager,
						// Add more detailed health checks here if needed
					},
				},
				timestamp: new Date().toISOString(),
			};

			successResponse(res, health, 200, req.requestId);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get cross-project knowledge health', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to get health: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /api/cross-project/transfer
	 * Manually trigger knowledge transfer between projects
	 */
	router.post('/transfer', async (req: Request, res: Response) => {
		try {
			logger.info('Manual knowledge transfer requested', { requestId: req.requestId });

			const isEnabled = env.CIPHER_CROSS_PROJECT_ENABLED;
			const crossProjectManager = agentServices.crossProjectManager;

			if (!isEnabled) {
				errorResponse(
					res,
					ERROR_CODES.SERVICE_UNAVAILABLE,
					'Cross-project knowledge system is disabled',
					503,
					undefined,
					req.requestId
				);
				return;
			}

			if (!crossProjectManager) {
				errorResponse(
					res,
					ERROR_CODES.SERVICE_UNAVAILABLE,
					'Cross-project knowledge manager not available',
					503,
					undefined,
					req.requestId
				);
				return;
			}

			// Get transfer parameters from request body
			const { sourceProject, targetProject, knowledgeTypes } = req.body;

			// Trigger manual knowledge transfer
			const result = await crossProjectManager.transferKnowledge({
				sourceProject,
				targetProject,
				knowledgeTypes: knowledgeTypes || ['patterns', 'solutions', 'guidelines'],
			});

			successResponse(
				res,
				{
					message: 'Knowledge transfer completed',
					result,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to trigger knowledge transfer', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to transfer knowledge: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/cross-project/projects
	 * Get list of registered projects
	 */
	router.get('/projects', async (req: Request, res: Response) => {
		try {
			logger.info('Getting registered projects', { requestId: req.requestId });

			const isEnabled = env.CIPHER_CROSS_PROJECT_ENABLED;
			const crossProjectManager = agentServices.crossProjectManager;

			if (!isEnabled) {
				errorResponse(
					res,
					ERROR_CODES.SERVICE_UNAVAILABLE,
					'Cross-project knowledge system is disabled',
					503,
					undefined,
					req.requestId
				);
				return;
			}

			if (!crossProjectManager) {
				errorResponse(
					res,
					ERROR_CODES.SERVICE_UNAVAILABLE,
					'Cross-project knowledge manager not available',
					503,
					undefined,
					req.requestId
				);
				return;
			}

			// Get registered projects (this would need to be implemented in CrossProjectManager)
			const projects = []; // Placeholder - implement getRegisteredProjects method

			successResponse(
				res,
				{
					projects,
					count: projects.length,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get registered projects', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to get projects: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/cross-project/configuration
	 * Get current configuration for cross-project knowledge system
	 */
	router.get('/configuration', async (req: Request, res: Response) => {
		try {
			logger.info('Getting cross-project knowledge configuration', { requestId: req.requestId });

			const configuration = {
				enabled: env.CIPHER_CROSS_PROJECT_ENABLED,
				autoTransfer: env.CIPHER_CROSS_PROJECT_AUTO_TRANSFER,
				masterGuides: env.CIPHER_CROSS_PROJECT_MASTER_GUIDES,
				performanceMonitoring: env.CIPHER_CROSS_PROJECT_PERFORMANCE_MONITORING,
				similarityThreshold: env.CIPHER_CROSS_PROJECT_SIMILARITY_THRESHOLD,
				maxConcurrentTransfers: env.CIPHER_CROSS_PROJECT_MAX_CONCURRENT_TRANSFERS,
				transferBatchSize: env.CIPHER_CROSS_PROJECT_TRANSFER_BATCH_SIZE,
				updateInterval: env.CIPHER_CROSS_PROJECT_UPDATE_INTERVAL,
				masterGuideUpdateInterval: env.CIPHER_CROSS_PROJECT_MASTER_GUIDE_UPDATE_INTERVAL,
				knowledgeRetentionDays: env.CIPHER_CROSS_PROJECT_KNOWLEDGE_RETENTION_DAYS,
				minConfidence: env.CIPHER_CROSS_PROJECT_MIN_CONFIDENCE,
				minRelevance: env.CIPHER_CROSS_PROJECT_MIN_RELEVANCE,
				maxPatterns: env.CIPHER_CROSS_PROJECT_MAX_PATTERNS,
				maxSolutions: env.CIPHER_CROSS_PROJECT_MAX_SOLUTIONS,
				enablePatternDetection: env.CIPHER_CROSS_PROJECT_ENABLE_PATTERN_DETECTION,
				enableSolutionExtraction: env.CIPHER_CROSS_PROJECT_ENABLE_SOLUTION_EXTRACTION,
				enableGuidelineGeneration: env.CIPHER_CROSS_PROJECT_ENABLE_GUIDELINE_GENERATION,
				minProjectsForGuide: env.CIPHER_CROSS_PROJECT_MIN_PROJECTS_FOR_GUIDE,
				maxGuideAgeDays: env.CIPHER_CROSS_PROJECT_MAX_GUIDE_AGE_DAYS,
				enableGuideVersioning: env.CIPHER_CROSS_PROJECT_ENABLE_GUIDE_VERSIONING,
				enableCrossDomainGuides: env.CIPHER_CROSS_PROJECT_ENABLE_CROSS_DOMAIN_GUIDES,
				enableAutoProjectDetection: env.CIPHER_CROSS_PROJECT_ENABLE_AUTO_PROJECT_DETECTION,
				enableAutoKnowledgeExtraction: env.CIPHER_CROSS_PROJECT_ENABLE_AUTO_KNOWLEDGE_EXTRACTION,
				enableAutoMasterGuideGeneration: env.CIPHER_CROSS_PROJECT_ENABLE_AUTO_MASTER_GUIDE_GENERATION,
				projectDetectionInterval: env.CIPHER_CROSS_PROJECT_PROJECT_DETECTION_INTERVAL,
				knowledgeExtractionThreshold: env.CIPHER_CROSS_PROJECT_KNOWLEDGE_EXTRACTION_THRESHOLD,
				masterGuideGenerationThreshold: env.CIPHER_CROSS_PROJECT_MASTER_GUIDE_GENERATION_THRESHOLD,
				logLevel: env.CIPHER_CROSS_PROJECT_LOG_LEVEL,
				enableDetailedLogging: env.CIPHER_CROSS_PROJECT_ENABLE_DETAILED_LOGGING,
				logTransfers: env.CIPHER_CROSS_PROJECT_LOG_TRANSFERS,
				logSynthesis: env.CIPHER_CROSS_PROJECT_LOG_SYNTHESIS,
				enableAnonymization: env.CIPHER_CROSS_PROJECT_ENABLE_ANONYMIZATION,
				anonymizeProjectNames: env.CIPHER_CROSS_PROJECT_ANONYMIZE_PROJECT_NAMES,
				enableContentFiltering: env.CIPHER_CROSS_PROJECT_ENABLE_CONTENT_FILTERING,
				filterSensitivePatterns: env.CIPHER_CROSS_PROJECT_FILTER_SENSITIVE_PATTERNS,
				integrateWithMemory: env.CIPHER_CROSS_PROJECT_INTEGRATE_WITH_MEMORY,
				integrateWithKnowledgeGraph: env.CIPHER_CROSS_PROJECT_INTEGRATE_WITH_KNOWLEDGE_GRAPH,
				integrateWithWorkspaceMemory: env.CIPHER_CROSS_PROJECT_INTEGRATE_WITH_WORKSPACE_MEMORY,
			};

			successResponse(
				res,
				{
					configuration,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get cross-project knowledge configuration', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Failed to get configuration: ${errorMsg}`,
				500,
				undefined,
				req.requestId
			);
		}
	});

	return router;
}
