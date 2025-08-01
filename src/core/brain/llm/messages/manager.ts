import { IMessageFormatter } from './formatters/types.js';
import { logger } from '../../../logger/index.js';
import { InternalMessage, ImageData } from './types.js';
import { getImageData } from './utils.js';
import { EnhancedPromptManager } from '../../../brain/systemPrompt/enhanced-manager.js';
import { ITokenizer, createTokenizer, getTokenizerConfigForModel } from '../tokenizer/index.js';
import {
	ICompressionStrategy,
	createCompressionStrategy,
	getCompressionConfigForProvider,
	EnhancedInternalMessage,
	CompressionResult,
	CompressionLevel,
} from '../compression/index.js';
import { assignMessagePriorities, calculateTotalTokens } from '../compression/utils.js';
import { IConversationHistoryProvider } from './history/types.js';

export class ContextManager {
	private promptManager: EnhancedPromptManager;
	private formatter: IMessageFormatter;
	private historyProvider: IConversationHistoryProvider | undefined;
	private sessionId: string | undefined;
	private messages: InternalMessage[] = [];

	// Token-aware compression components
	private tokenizer?: ITokenizer;
	private compressionStrategy?: ICompressionStrategy;
	private enableCompression = false;

	// Token tracking
	private currentTokenCount = 0;
	private compressionHistory: CompressionResult[] = [];
	private lastCompressionCheck = 0;

	// Configuration
	private readonly compressionConfig = {
		checkInterval: 5000, // Check every 5 seconds
		maxCompressionHistory: 10,
	};

	private fallbackToMemory = false;

	constructor(
		formatter: IMessageFormatter,
		promptManager: EnhancedPromptManager,
		historyProvider: IConversationHistoryProvider | undefined,
		sessionId: string | undefined
	) {
		if (!formatter) {
			throw new Error('formatter is required');
		}

		this.formatter = formatter;
		this.promptManager = promptManager;
		this.historyProvider = historyProvider;
		this.sessionId = sessionId;

		logger.debug('ContextManager initialized with formatter', { formatter });
	}

	// Public API Methods
	async getSystemPrompt(): Promise<string> {
		const result = await this.promptManager.generateSystemPrompt();
		logger.debug(`[SystemPrompt] Built complete system prompt (${result.content.length} chars)`);
		return result.content;
	}

	async addMessage(message: InternalMessage): Promise<void> {
		this.validateMessage(message);
		await this.storeMessage(message);

		logger.debug(`Adding message to context: ${JSON.stringify(message, null, 2)}`);
		logger.debug(`Total messages in context: ${this.messages.length}`);

		if (this.enableCompression) {
			await this.updateTokenCount();
			await this.checkAndCompress();
		}
	}

	async restoreHistory(): Promise<void> {
		if (this.historyProvider && this.sessionId) {
			try {
				this.messages = await this.historyProvider.getHistory(this.sessionId);
				logger.debug(`Restored ${this.messages.length} messages from persistent history.`);
			} catch (err) {
				logger.error(`Failed to restore history from provider: ${err}`);
				this.fallbackToMemory = true;
			}
		}
	}

	async addUserMessage(textContent: string, imageData?: ImageData): Promise<void> {
		if (typeof textContent !== 'string' || textContent.trim() === '') {
			throw new Error('Content must be a non-empty string.');
		}

		const messageParts: InternalMessage['content'] = this.buildUserMessageContent(
			textContent,
			imageData
		);

		logger.debug(`Adding user message: ${JSON.stringify(messageParts, null, 2)}`);
		await this.addMessage({ role: 'user', content: messageParts });
	}

	async addAssistantMessage(
		content: string | null,
		toolCalls?: InternalMessage['toolCalls']
	): Promise<void> {
		if (content === null && (!toolCalls || toolCalls.length === 0)) {
			throw new Error('Must provide content or toolCalls.');
		}

		await this.addMessage({
			role: 'assistant' as const,
			content,
			...(toolCalls && toolCalls.length > 0 && { toolCalls }),
		});
	}

	async addToolResult(toolCallId: string, name: string, result: any): Promise<void> {
		if (!toolCallId || !name) {
			throw new Error('addToolResult: toolCallId and name are required.');
		}

		const content = this.formatToolResultContent(result);
		await this.addMessage({ role: 'tool', content, toolCallId, name });
	}

	async getFormattedMessage(_message: InternalMessage): Promise<any[]> {
		try {
			return this.getAllFormattedMessages();
		} catch (error) {
			logger.error('Failed to get formatted messages', { error });
			throw new Error(
				`Failed to format message: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	async getAllFormattedMessages(includeSystemMessage: boolean = true): Promise<any[]> {
		try {
			const formattedMessages: any[] = [];
			const prompt = await this.getSystemPrompt();
			if (includeSystemMessage && prompt) {
				formattedMessages.push({ role: 'system', content: prompt });
			}

			for (const msg of this.messages) {
				const formatted = this.formatter.format(msg, null);

				if (Array.isArray(formatted)) {
					formattedMessages.push(...formatted);
				} else if (formatted && formatted !== null) {
					formattedMessages.push(formatted);
				}
			}

			logger.debug(
				`Formatted ${formattedMessages.length} messages from history of ${this.messages.length} messages`
			);
			return formattedMessages;
		} catch (error) {
			logger.error('Failed to format all messages', { error });
			throw new Error(
				`Failed to format messages: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	async processLLMStreamResponse(response: any): Promise<void> {
		if (this.formatter.parseStreamResponse) {
			const msgs = (await this.formatter.parseStreamResponse(response)) ?? [];
			await this.processMessages(msgs);
		} else {
			await this.processLLMResponse(response);
		}
	}

	async processLLMResponse(response: any): Promise<void> {
		const msgs = this.formatter.parseResponse(response) ?? [];
		await this.processMessages(msgs);
	}

	// Message retrieval methods
	getRawMessages(): InternalMessage[] {
		return this.messages;
	}

	/**
	 * @deprecated Use getRawMessagesAsync() for persistent storage support
	 */
	getRawMessagesSync(): InternalMessage[] {
		return this.messages;
	}

	async getRawMessagesAsync(): Promise<InternalMessage[]> {
		if (this.shouldUsePersistentStorage()) {
			try {
				return await this.historyProvider!.getHistory(this.sessionId!);
			} catch (err) {
				logger.error(
					`History provider failed in getRawMessages, falling back to in-memory: ${err}`
				);
				this.fallbackToMemory = true;
				return this.messages;
			}
		} else {
			return this.messages;
		}
	}

	async restoreHistoryPersistent(): Promise<void> {
		if (this.shouldUsePersistentStorage()) {
			try {
				const history = await this.historyProvider!.getHistory(this.sessionId!);
				this.messages = history;
				logger.debug(`ContextManager: Restored ${history.length} messages from persistent storage`);
			} catch (err) {
				logger.error(
					`ContextManager: Failed to restore history, falling back to in-memory: ${err}`
				);
				this.fallbackToMemory = true;
			}
		}
	}

	// Compression configuration and management
	async configureCompression(
		provider: string,
		model?: string,
		contextWindow?: number
	): Promise<void> {
		try {
			this.tokenizer = this.createTokenizer(model, provider);
			this.compressionStrategy = this.createCompressionStrategy(provider, model, contextWindow);
			this.enableCompression = true;

			await this.updateTokenCount();

			logger.debug('Token-aware compression configured', {
				provider,
				model,
				contextWindow,
				tokenizerProvider: this.tokenizer.provider,
				compressionStrategy: this.compressionStrategy.name,
				currentTokens: this.currentTokenCount,
			});
		} catch (error) {
			logger.error('Failed to configure compression', { error, provider, model });
			this.enableCompression = false;
		}
	}

	getCompressionLevel(): CompressionLevel {
		if (!this.compressionStrategy) {
			return CompressionLevel.NONE;
		}

		return this.compressionStrategy.getCompressionLevel(this.currentTokenCount);
	}

	getTokenStats(): {
		currentTokens: number;
		maxTokens: number;
		utilization: number;
		compressionLevel: CompressionLevel;
		compressionHistory: number;
	} {
		const maxTokens = this.compressionStrategy?.config.maxTokens || 0;

		return {
			currentTokens: this.currentTokenCount,
			maxTokens,
			utilization: maxTokens > 0 ? this.currentTokenCount / maxTokens : 0,
			compressionLevel: this.getCompressionLevel(),
			compressionHistory: this.compressionHistory.length,
		};
	}

	async forceCompression(): Promise<CompressionResult | null> {
		if (!this.enableCompression || !this.compressionStrategy) {
			throw new Error('Compression not configured');
		}

		await this.performCompression();
		return this.compressionHistory[this.compressionHistory.length - 1] || null;
	}

	// Private helper methods
	private validateMessage(message: InternalMessage): void {
		if (!message.role) {
			throw new Error('Role is required for a message');
		}

		switch (message.role) {
			case 'user':
				this.validateUserMessage(message);
				break;
			case 'assistant':
				this.validateAssistantMessage(message);
				break;
			case 'tool':
				this.validateToolMessage(message);
				break;
			case 'system':
				this.validateSystemMessage(message);
				break;
			default:
				throw new Error(`Unknown message role: ${(message as any).role}`);
		}
	}

	private validateUserMessage(message: InternalMessage): void {
		const hasValidArrayContent = Array.isArray(message.content) && message.content.length > 0;
		const hasValidStringContent =
			typeof message.content === 'string' && message.content.trim() !== '';

		if (!hasValidArrayContent && !hasValidStringContent) {
			throw new Error(
				'User message content should be a non-empty string or a non-empty array of parts.'
			);
		}
	}

	private validateAssistantMessage(message: InternalMessage): void {
		if (message.content === null && (!message.toolCalls || message.toolCalls.length === 0)) {
			throw new Error('Assistant message must have content or toolCalls.');
		}

		if (message.toolCalls && !this.isValidToolCalls(message.toolCalls)) {
			throw new Error('Invalid toolCalls structure in assistant message.');
		}
	}

	private validateToolMessage(message: InternalMessage): void {
		if (!message.toolCallId || !message.name || message.content === null) {
			throw new Error('Tool message missing required fields (toolCallId, name, content).');
		}
	}

	private validateSystemMessage(message: InternalMessage): void {
		if (typeof message.content !== 'string' || message.content.trim() === '') {
			throw new Error('System message content must be a non-empty string.');
		}
	}

	private isValidToolCalls(toolCalls: any[]): boolean {
		return (
			Array.isArray(toolCalls) &&
			!toolCalls.some(tc => !tc.id || !tc.function?.name || !tc.function?.arguments)
		);
	}

	private async storeMessage(message: InternalMessage): Promise<void> {
		if (this.shouldUsePersistentStorage()) {
			try {
				await this.historyProvider!.saveMessage(this.sessionId!, message);
				this.messages.push(message);
			} catch (err) {
				logger.error(`History provider failed, falling back to in-memory: ${err}`);
				this.fallbackToMemory = true;
				this.messages.push(message);
			}
		} else {
			this.messages.push(message);
		}
	}

	private shouldUsePersistentStorage(): boolean {
		return !!(this.historyProvider && this.sessionId && !this.fallbackToMemory);
	}

	private buildUserMessageContent(
		textContent: string,
		imageData?: ImageData
	): InternalMessage['content'] {
		return imageData
			? [
					{ type: 'text', text: textContent },
					{
						type: 'image',
						image: imageData.image,
						mimeType: imageData.mimeType || 'image/jpeg',
					},
				]
			: [{ type: 'text', text: textContent }];
	}

	private formatToolResultContent(result: any): InternalMessage['content'] {
		if (result && typeof result === 'object' && 'image' in result) {
			const imagePart = result as {
				image: string | Uint8Array | Buffer | ArrayBuffer | URL;
				mimeType?: string;
			};

			return [
				{
					type: 'image',
					image: getImageData(imagePart),
					mimeType: imagePart.mimeType || 'image/jpeg',
				},
			];
		}

		if (typeof result === 'string') {
			return result;
		}

		if (Array.isArray(result)) {
			return result;
		}

		return JSON.stringify(result ?? '');
	}

	private async processMessages(msgs: InternalMessage[]): Promise<void> {
		for (const msg of msgs) {
			try {
				await this.addMessage(msg);
			} catch (error) {
				logger.error('Failed to process LLM response message', { error });
			}
		}
	}

	private createTokenizer(model?: string, provider?: string): ITokenizer {
		const tokenizerConfig = getTokenizerConfigForModel(model || `${provider}-default`);
		return createTokenizer(tokenizerConfig);
	}

	private createCompressionStrategy(
		provider: string,
		model?: string,
		contextWindow?: number
	): ICompressionStrategy {
		const compressionConfig = getCompressionConfigForProvider(provider, model, contextWindow);
		return createCompressionStrategy(compressionConfig);
	}

	// Token management methods
	private async updateTokenCount(): Promise<void> {
		if (!this.tokenizer || this.messages.length === 0) {
			this.currentTokenCount = 0;
			logger.debug('[TokenAware] Token count reset (no messages or tokenizer)');
			return;
		}

		try {
			const messageTokenCounts = await this.calculateMessageTokens();
			this.currentTokenCount = messageTokenCounts.reduce((sum, count) => sum + count, 0);

			logger.info(
				`[TokenAware] Token count updated: ${this.currentTokenCount} tokens for ${this.messages.length} messages`
			);
		} catch (error) {
			logger.error('[TokenAware] Failed to update token count', { error });
		}
	}

	private async calculateMessageTokens(): Promise<number[]> {
		return Promise.all(
			this.messages.map(async (message, index) => {
				const textContent = this.extractTextFromMessage(message);
				const tokenCount = await this.tokenizer!.countTokens(textContent);

				if ('tokenCount' in message) {
					(message as any).tokenCount = tokenCount.total;
				}

				return tokenCount.total;
			})
		);
	}

	private extractTextFromMessage(message: InternalMessage): string {
		if (typeof message.content === 'string') {
			return message.content;
		}

		if (Array.isArray(message.content)) {
			return message.content
				.filter(part => part.type === 'text')
				.map(part => part.text)
				.join(' ');
		}

		return '';
	}

	// Compression methods
	private async checkAndCompress(): Promise<void> {
		if (!this.shouldCheckCompression()) {
			return;
		}

		this.lastCompressionCheck = Date.now();

		const utilization = this.calculateUtilization();
		this.logCompressionWarningIfNeeded(utilization);

		if (this.compressionStrategy!.shouldCompress(this.currentTokenCount)) {
			logger.info(
				`[TokenAware] Compression threshold reached (${Math.round(utilization * 100)}%), starting compression...`
			);
			await this.performCompression();
		}
	}

	private shouldCheckCompression(): boolean {
		if (!this.enableCompression || !this.compressionStrategy || !this.tokenizer) {
			return false;
		}

		const now = Date.now();
		return now - this.lastCompressionCheck >= this.compressionConfig.checkInterval;
	}

	private calculateUtilization(): number {
		return this.currentTokenCount / (this.compressionStrategy!.config.maxTokens || 1);
	}

	private logCompressionWarningIfNeeded(utilization: number): void {
		const config = this.compressionStrategy!.config;

		if (utilization >= config.warningThreshold && utilization < config.compressionThreshold) {
			logger.warn(
				`[TokenAware] Token usage warning: ${Math.round(utilization * 100)}% of context window (${this.currentTokenCount}/${config.maxTokens})`
			);
		}
	}

	private async performCompression(): Promise<void> {
		if (!this.compressionStrategy || !this.tokenizer) {
			return;
		}

		try {
			const enhancedMessages = this.enhanceMessagesForCompression();
			const prioritizedMessages = assignMessagePriorities(enhancedMessages);
			const targetTokenCount = this.calculateTargetTokenCount();

			const compressionResult = await this.compressionStrategy.compress(
				prioritizedMessages,
				this.currentTokenCount,
				targetTokenCount
			);

			if (!this.compressionStrategy.validateCompression(compressionResult)) {
				logger.warn('[TokenAware] Compression validation failed, keeping original messages');
				return;
			}

			await this.applyCompressionResult(compressionResult);
		} catch (error) {
			logger.error('[TokenAware] Compression failed', { error });
		}
	}

	private enhanceMessagesForCompression(): EnhancedInternalMessage[] {
		return this.messages.map((message, index) => ({
			...message,
			messageId: `msg_${Date.now()}_${index}`,
			timestamp: Date.now() - (this.messages.length - index) * 1000,
			tokenCount: this.extractTextFromMessage(message).length / 4, // Rough estimate
		}));
	}

	private calculateTargetTokenCount(): number {
		return Math.floor(this.compressionStrategy!.config.maxTokens * 0.8);
	}

	private async applyCompressionResult(compressionResult: CompressionResult): Promise<void> {
		// Convert back to InternalMessage format
		this.messages = compressionResult.compressedMessages.map(msg => {
			const {
				messageId,
				timestamp,
				tokenCount,
				priority,
				preserveInCompression,
				...internalMessage
			} = msg;
			return internalMessage;
		});

		await this.updateTokenCount();
		this.updateCompressionHistory(compressionResult);

		logger.info(
			`[TokenAware] Compression completed: ${compressionResult.originalTokenCount} → ${compressionResult.compressedTokenCount} tokens`
		);
	}

	private updateCompressionHistory(compressionResult: CompressionResult): void {
		this.compressionHistory.push(compressionResult);

		if (this.compressionHistory.length > this.compressionConfig.maxCompressionHistory) {
			this.compressionHistory.shift();
		}
	}
}
