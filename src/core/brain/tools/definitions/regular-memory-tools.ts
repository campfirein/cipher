/**
 * Regular Memory Tools Module
 *
 * This module provides tool definitions for regular memory mode.
 * When AGENTIC_MEMORY_ENABLED=false, only these tools will be loaded.
 */

import type { InternalToolSet } from '../types.js';
import { logger } from '../../../logger/index.js';
import { env } from '../../../env.js';

/**
 * Get all tools for regular memory mode
 */
export async function getRegularMemoryTools(): Promise<InternalToolSet> {
	try {
		logger.debug('Loading regular memory tools...');

		// Load regular memory tools
		let memoryTools: InternalToolSet = {};

		try {
			memoryTools = await import('./memory/index.js').then(m => m.getMemoryTools());
			logger.debug(`Loaded ${Object.keys(memoryTools).length} regular memory tools`);
		} catch (error) {
			logger.warn('Failed to load regular memory tools', {
				error: error instanceof Error ? error.message : String(error),
			});
		}

		// Conditionally load knowledge graph tools based on environment setting
		let knowledgeGraphTools: InternalToolSet = {};
		if (env.KNOWLEDGE_GRAPH_ENABLED) {
			logger.debug('Knowledge graph enabled, loading knowledge graph tools');
			knowledgeGraphTools = await import('./knowledge_graph/index.js').then(m =>
				m.getKnowledgeGraphTools()
			);
		} else {
			logger.debug('Knowledge graph disabled, skipping knowledge graph tools');
		}

		// Combine tools for regular memory mode
		const allTools: InternalToolSet = {
			...memoryTools,
			...knowledgeGraphTools,
		};

		logger.info('Regular memory tools loaded successfully', {
			totalTools: Object.keys(allTools).length,
			memoryTools: Object.keys(memoryTools).length,
			knowledgeGraphTools: Object.keys(knowledgeGraphTools).length,
			knowledgeGraphEnabled: env.KNOWLEDGE_GRAPH_ENABLED,
			memorySystemMode: 'regular',
			actualMemoryToolNames: Object.keys(memoryTools),
		});

		return allTools;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Failed to load regular memory tools', { error: errorMessage });
		throw new Error(`Failed to load regular memory tools: ${errorMessage}`);
	}
}
