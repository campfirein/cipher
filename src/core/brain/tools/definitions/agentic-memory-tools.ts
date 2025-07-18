/**
 * Agentic Memory Tools Module
 *
 * This module provides tool definitions specifically for agentic memory mode.
 * When AGENTIC_MEMORY_ENABLED=true, these tools are loaded alongside regular memory tools.
 */

import type { InternalToolSet } from '../types.js';
import { logger } from '../../../logger/index.js';
import { env } from '../../../env.js';

/**
 * Get all tools for agentic memory mode
 */
export async function getAgenticMemoryTools(): Promise<InternalToolSet> {
	try {
		logger.debug('Loading agentic memory tools...');

		// Load agentic memory tools
		let agenticMemoryTools: InternalToolSet = {};
		try {
			const agenticMemoryModule = await import('./agentic_memory/index.js');
			agenticMemoryTools = agenticMemoryModule.agenticMemoryTools.reduce(
				(acc: InternalToolSet, tool: any) => {
					acc[tool.name] = tool;
					return acc;
				},
				{}
			);
			logger.debug(`Loaded ${Object.keys(agenticMemoryTools).length} agentic memory tools`);
		} catch (error) {
			logger.warn('Failed to load agentic memory tools', {
				error: error instanceof Error ? error.message : String(error),
			});
		}

		// Also load regular memory tools to ensure full compatibility and testing
		let regularMemoryTools: InternalToolSet = {};
		try {
			regularMemoryTools = await import('./memory/index.js').then(m => m.getMemoryTools());
			logger.debug(
				`Loaded ${Object.keys(regularMemoryTools).length} regular memory tools for compatibility`
			);
		} catch (error) {
			logger.warn('Failed to load regular memory tools in agentic mode', {
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

		// Combine tools for agentic memory mode
		const allTools: InternalToolSet = {
			...agenticMemoryTools,
			...regularMemoryTools,
			...knowledgeGraphTools,
		};

		logger.info('Agentic memory tools loaded successfully', {
			totalTools: Object.keys(allTools).length,
			agenticMemoryTools: Object.keys(agenticMemoryTools).length,
			regularMemoryTools: Object.keys(regularMemoryTools).length,
			knowledgeGraphTools: Object.keys(knowledgeGraphTools).length,
			knowledgeGraphEnabled: env.KNOWLEDGE_GRAPH_ENABLED,
			memorySystemMode: 'agentic',
			actualAgenticMemoryToolNames: Object.keys(agenticMemoryTools),
		});

		return allTools;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Failed to load agentic memory tools', { error: errorMessage });
		throw new Error(`Failed to load agentic memory tools: ${errorMessage}`);
	}
}
