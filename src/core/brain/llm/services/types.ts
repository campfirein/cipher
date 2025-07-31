import { ToolSet } from '../../../mcp/types.js';
import { ImageData } from '../messages/types.js';

/**
 * The LLMService interface provides a contract for interacting with an LLM service.
 * It defines methods for generating text, retrieving available tools, and retrieving the service configuration.
 */

export interface ILLMService {
	generate(userInput: string, imageData?: ImageData, sessionId?: string): Promise<string>;
	directGenerate(userInput: string, systemPrompt?: string): Promise<string>;
	getAllTools(): Promise<ToolSet>;
	getConfig(): LLMServiceConfig;
}

/**
 * The LLMServiceConfig interface defines the configuration for an LLM service.
 * It includes the provider and model information.
 */

export type LLMServiceConfig = {
	provider: string;
	model: string;
};
