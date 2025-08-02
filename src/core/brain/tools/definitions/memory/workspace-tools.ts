/**
 * Workspace Memory Tools Module
 *
 * This module exports workspace memory tools for team collaboration,
 * project progress tracking, and shared context management.
 */

import { workspaceSearchTool } from './workspace_search.js';
import { workspaceStoreTool } from './workspace_store.js';
import type { InternalTool } from '../../types.js';
import { env } from '../../../../env.js';
import { logger } from '../../../../logger/index.js';

// Export individual workspace tools
export { workspaceSearchTool, workspaceStoreTool };

// Export workspace payload utilities
export {
	createWorkspacePayload,
	extractWorkspaceInfo,
	type WorkspacePayload,
} from './workspace-payloads.js';

// Export workspace configuration
export {
	loadWorkspaceConfigFromEnv,
	validateWorkspaceMemoryConfig,
	DEFAULT_WORKSPACE_CONFIG,
	type WorkspaceMemoryConfig,
	type WorkspaceToolConfig,
	type WorkspaceBehaviorConfig,
} from '../../../../config/workspace-memory-config.schema.js';

/**
 * Array of all workspace memory tools
 */
export async function getWorkspaceToolsArray(
	options: { embeddingEnabled?: boolean } = {}
): Promise<InternalTool[]> {
	const toolMap = await getAllWorkspaceToolDefinitions(options);
	return Object.values(toolMap);
}

/**
 * Get all workspace tools as a map
 */
export async function getWorkspaceTools(
	options: { embeddingEnabled?: boolean } = {}
): Promise<Record<string, InternalTool>> {
	const { embeddingEnabled = true } = options;

	// Check if workspace memory is enabled
	if (env.USE_WORKSPACE_MEMORY !== true) {
		logger.debug('Workspace memory is disabled - excluding all workspace tools');
		return {};
	}

	// If embeddings are disabled, exclude all embedding-dependent tools
	if (!embeddingEnabled) {
		logger.warn('Embeddings disabled - excluding all embedding-dependent workspace tools', {
			excludedTools: ['cipher_workspace_search', 'cipher_workspace_store'],
		});
		return {};
	}

	return {
		cipher_workspace_search: workspaceSearchTool,
		cipher_workspace_store: workspaceStoreTool,
	};
}

/**
 * Get workspace tool definitions for registration
 */
export async function getAllWorkspaceToolDefinitions(
	options: { embeddingEnabled?: boolean } = {}
): Promise<Record<string, InternalTool>> {
	const { embeddingEnabled = true } = options;

	// Check if workspace memory is enabled
	if (env.USE_WORKSPACE_MEMORY !== true) {
		logger.debug('Workspace memory is disabled - no workspace tool definitions');
		return {};
	}

	// If embeddings are disabled, return empty tools
	if (!embeddingEnabled) {
		return {};
	}

	// Base workspace tools available when embeddings are enabled
	const tools: Record<string, InternalTool> = {
		workspace_search: workspaceSearchTool,
		workspace_store: workspaceStoreTool,
	};

	return tools;
}

/**
 * Check if default memory should be disabled when workspace memory is active
 */
export function shouldDisableDefaultMemory(): boolean {
	// Only disable default memory if BOTH conditions are explicitly true
	return env.USE_WORKSPACE_MEMORY === true && env.DISABLE_DEFAULT_MEMORY === true;
}

/**
 * Get the workspace vector store collection name
 */
export function getWorkspaceCollectionName(): string {
	return env.WORKSPACE_VECTOR_STORE_COLLECTION || 'workspace_memory';
}

/**
 * Workspace tool categories and descriptions
 */
export const WORKSPACE_TOOL_INFO = {
	workspace_search: {
		category: 'memory',
		purpose:
			'Search workspace memory for team and project information including progress, bugs, and collaboration context.',
		useCase:
			'Use when you need to find information about team activities, project status, bug reports, or collaboration history.',
	},
	workspace_store: {
		category: 'memory',
		purpose:
			'Background tool that automatically stores team-related information including project progress, bugs, and collaboration context.',
		useCase:
			'Automatically captures workspace information in the background to build team knowledge and project context.',
	},
} as const;

/**
 * Check if workspace memory is properly configured
 */
export function validateWorkspaceMemorySetup(): {
	isValid: boolean;
	issues: string[];
	warnings: string[];
} {
	const issues: string[] = [];
	const warnings: string[] = [];

	// Check if workspace memory is enabled
	if (!env.USE_WORKSPACE_MEMORY) {
		warnings.push('Workspace memory is disabled (USE_WORKSPACE_MEMORY=false)');
	}

	// Check if both workspace and default memory are enabled
	if (env.USE_WORKSPACE_MEMORY && !env.DISABLE_DEFAULT_MEMORY) {
		warnings.push(
			'Both workspace and default memory are enabled - consider setting DISABLE_DEFAULT_MEMORY=true for workspace-only mode'
		);
	}

	// Check collection name
	const collectionName = env.WORKSPACE_VECTOR_STORE_COLLECTION;
	if (!collectionName) {
		warnings.push('WORKSPACE_VECTOR_STORE_COLLECTION not set, using default "workspace_memory"');
	} else if (collectionName === env.VECTOR_STORE_COLLECTION) {
		issues.push(
			'Workspace and default memory collections have the same name - this will cause conflicts'
		);
	}

	// Check workspace vector store type
	if (
		env.WORKSPACE_VECTOR_STORE_TYPE &&
		env.WORKSPACE_VECTOR_STORE_TYPE !== env.VECTOR_STORE_TYPE
	) {
		warnings.push(
			`Workspace memory will use ${env.WORKSPACE_VECTOR_STORE_TYPE} while default memory uses ${env.VECTOR_STORE_TYPE}`
		);
	}

	return {
		isValid: issues.length === 0,
		issues,
		warnings,
	};
}

/**
 * Log workspace memory configuration status
 */
export function logWorkspaceMemoryStatus(): void {
	const validation = validateWorkspaceMemorySetup();

	if (env.USE_WORKSPACE_MEMORY) {
		logger.info('Workspace memory is enabled', {
			collection: getWorkspaceCollectionName(),
			disableDefault: env.DISABLE_DEFAULT_MEMORY,
			workspaceVectorStoreType: env.WORKSPACE_VECTOR_STORE_TYPE || 'same as default',
		});

		if (validation.warnings.length > 0) {
			logger.warn('Workspace memory configuration warnings', {
				warnings: validation.warnings,
			});
		}

		if (validation.issues.length > 0) {
			logger.error('Workspace memory configuration issues', {
				issues: validation.issues,
			});
		}
	} else {
		logger.debug('Workspace memory is disabled');
	}
}
