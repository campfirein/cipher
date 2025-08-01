/**
 * Built-in Dynamic Content Generators
 *
 * Provides common dynamic content generators for system prompts.
 * These generators can be used in dynamic providers to inject runtime context.
 */

import { DynamicContentGenerator } from './providers/dynamic-provider.js';
import { ProviderContext } from './interfaces.js';

/**
 * Generate timestamp-based content
 */
export const timestampGenerator: DynamicContentGenerator = async (
	context: ProviderContext,
	config: Record<string, any>
): Promise<string> => {
	const format = config.format || 'iso';
	const includeTimezone = config.includeTimezone || false;

	switch (format) {
		case 'iso':
			return context.timestamp.toISOString();
		case 'locale': {
			const options: Intl.DateTimeFormatOptions = {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				...(includeTimezone && { timeZoneName: 'short' }),
			};
			return context.timestamp.toLocaleString('en-US', options);
		}
		case 'date-only':
			return context.timestamp.toISOString().split('T')[0]!;
		case 'time-only':
			return context.timestamp.toISOString().split('T')[1]!.split('.')[0]!;
		default:
			return context.timestamp.toString();
	}
};

/**
 * Generate session context information
 */
export const sessionContextGenerator: DynamicContentGenerator = async (
	context: ProviderContext,
	config: Record<string, any>
) => {
	const includeFields = config.includeFields || ['sessionId', 'userId'];
	const format = config.format || 'list';

	const contextInfo: string[] = [];

	if (includeFields.includes('sessionId') && context.sessionId) {
		contextInfo.push(`Session ID: ${context.sessionId}`);
	}

	if (includeFields.includes('userId') && context.userId) {
		contextInfo.push(`User ID: ${context.userId}`);
	}

	if (includeFields.includes('timestamp')) {
		contextInfo.push(`Timestamp: ${context.timestamp.toISOString()}`);
	}

	if (contextInfo.length === 0) {
		return '';
	}

	switch (format) {
		case 'list': {
			return contextInfo.join('\n');
		}
		case 'inline': {
			return contextInfo.join(', ');
		}
		case 'json': {
			const obj: Record<string, any> = {};
			if (includeFields.includes('sessionId') && context.sessionId)
				obj.sessionId = context.sessionId;
			if (includeFields.includes('userId') && context.userId) obj.userId = context.userId;
			if (includeFields.includes('timestamp')) obj.timestamp = context.timestamp.toISOString();
			return JSON.stringify(obj, null, 2);
		}
		default: {
			return contextInfo.join('\n');
		}
	}
};

/**
 * Generate memory-related context
 */
export const memoryContextGenerator: DynamicContentGenerator = async (
	context: ProviderContext,
	config: Record<string, any>
) => {
	if (!context.memoryContext) {
		return config.emptyMessage || 'No memory context available';
	}

	const format = config.format || 'summary';
	const maxItems = config.maxItems || 5;

	switch (format) {
		case 'summary': {
			const itemCount = Object.keys(context.memoryContext).length;
			return `Memory context contains ${itemCount} items`;
		}
		case 'list': {
			const items = Object.entries(context.memoryContext).slice(0, maxItems);
			return items.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
		}
		case 'json': {
			return JSON.stringify(context.memoryContext, null, 2);
		}
		default: {
			return 'Memory context is available';
		}
	}
};

/**
 * Generate environment-specific instructions
 */
export const environmentGenerator: DynamicContentGenerator = async (
	context: ProviderContext,
	config: Record<string, any>
) => {
	const environment = config.environment || 'production';
	const customMessages = config.messages || {};

	const defaultMessages = {
		development: 'Development mode: Enhanced logging and debugging features are available.',
		staging: 'Staging environment: Please verify all changes before promoting to production.',
		production: 'Production environment: Exercise caution with all operations.',
		testing: 'Testing mode: Automated testing features are enabled.',
	};

	return (
		customMessages[environment] ||
		defaultMessages[environment as keyof typeof defaultMessages] ||
		`Environment: ${environment}`
	);
};

/**
 * Generate conditional content based on context
 */
export const conditionalGenerator: DynamicContentGenerator = async (
	context: ProviderContext,
	config: Record<string, any>
) => {
	const conditions = config.conditions || [];

	for (const condition of conditions) {
		if (evaluateCondition(condition.if, context)) {
			return condition.then || '';
		}
	}

	return config.else || '';
};

/**
 * Simple condition evaluator for conditional generator
 */
function evaluateCondition(condition: any, context: ProviderContext): boolean {
	if (typeof condition === 'string') {
		// Simple string conditions like 'userId' (checks if userId exists)
		return !!(context as any)[condition];
	}

	if (typeof condition === 'object' && condition !== null) {
		// Object conditions like { field: 'userId', operator: 'exists' }
		const { field, operator, value } = condition;
		const fieldValue = (context as any)[field];

		switch (operator) {
			case 'exists':
				return fieldValue !== undefined && fieldValue !== null && fieldValue !== '';
			case 'equals':
				return fieldValue === value;
			case 'contains':
				return typeof fieldValue === 'string' && fieldValue.includes(value);
			case 'gt':
				return typeof fieldValue === 'number' && fieldValue > value;
			case 'lt':
				return typeof fieldValue === 'number' && fieldValue < value;
			default:
				return false;
		}
	}

	return false;
}

/**
 * Helper to fetch session history for dynamic LLM-driven generators
 */
async function fetchSessionHistory(
	context: ProviderContext,
	config: Record<string, any>
): Promise<string[]> {
	const sessionId = context.sessionId;
	const historyConfig = config.history || 'all';
	const metadata = context.metadata || {};
	const storageManager = metadata.storageManager;
	if (!sessionId || !storageManager) return [];
	// Import here to avoid circular deps
	const { createDatabaseHistoryProvider } = await import('../llm/messages/history/factory.js');
	const historyProvider = createDatabaseHistoryProvider(storageManager);
	let limit = 1000;
	if (typeof historyConfig === 'number') limit = historyConfig;
	if (typeof historyConfig === 'string' && historyConfig !== 'all')
		limit = parseInt(historyConfig, 10) || 1000;
	const messages = await historyProvider.getHistory(sessionId, limit);
	// Map content to string
	return messages.map(m => {
		if (typeof m.content === 'string') return m.content;
		if (Array.isArray(m.content)) {
			return m.content.map(seg => (seg.type === 'text' ? seg.text : '[Image]')).join(' ');
		}
		return '';
	});
}

/**
 * Helper to get llmService from context.metadata
 */
function getLLMService(context: ProviderContext): any {
	return context.metadata?.llmService;
}

/**
 * LLM-driven summary generator
 */
export const summaryGenerator: DynamicContentGenerator = async (context, config) => {
	const llmService = getLLMService(context);
	if (!llmService) return '[LLM service unavailable: cannot generate summary]';
	const history = await fetchSessionHistory(context, config);
	if (!history.length) return '[No session history to summarize]';
	const prompt = `Summarize the following conversation in a concise paragraph (maximum 4-5 sentences) for the system prompt.\n\n${history.join('\n')}\n\nSummary:`;
	return await llmService.directGenerate(prompt);
};

/**
 * LLM-driven rules/specs extraction generator
 */
export const rulesGenerator: DynamicContentGenerator = async (context, config) => {
	const llmService = getLLMService(context);
	if (!llmService) return '[LLM service unavailable: cannot extract rules]';
	const history = await fetchSessionHistory(context, config);
	if (!history.length) return '[No session history to extract rules from]';
	const prompt = `Extract any rules, requirements, or project specifications set by the user in the following conversation. List them clearly and concisely for the system prompt (maximum 4-5 sentences).\n\n${history.join('\n')}\n\nRules/Specs:`;
	return await llmService.directGenerate(prompt);
};

/**
 * LLM-driven error/bug detection generator
 */
export const errorDetectionGenerator: DynamicContentGenerator = async (context, config) => {
	const llmService = getLLMService(context);
	if (!llmService) return '[LLM service unavailable: cannot detect errors]';
	const history = await fetchSessionHistory(context, config);
	if (!history.length) return '[No session history to detect errors from]';
	const prompt = `Identify any errors, bugs, or issues discussed or emphasized by the user in the following conversation. List them concisely for the system prompt (maximum 4-5 sentences).\n\n${history.join('\n')}\n\nErrors/Bugs:`;
	return await llmService.directGenerate(prompt);
};

/**
 * Register all built-in generators
 */
export async function registerBuiltInGenerators() {
	const { DynamicPromptProvider } = await import('./providers/dynamic-provider.js');

	DynamicPromptProvider.registerGenerator('timestamp', timestampGenerator);
	DynamicPromptProvider.registerGenerator('session-context', sessionContextGenerator);
	DynamicPromptProvider.registerGenerator('memory-context', memoryContextGenerator);
	DynamicPromptProvider.registerGenerator('environment', environmentGenerator);
	DynamicPromptProvider.registerGenerator('conditional', conditionalGenerator);
	// Register new LLM-driven generators
	DynamicPromptProvider.registerGenerator('summary', summaryGenerator);
	DynamicPromptProvider.registerGenerator('rules', rulesGenerator);
	DynamicPromptProvider.registerGenerator('error-detection', errorDetectionGenerator);
}

/**
 * Get all built-in generator names
 */
export function getBuiltInGeneratorNames(): string[] {
	return ['timestamp', 'session-context', 'memory-context', 'environment', 'conditional'];
}
