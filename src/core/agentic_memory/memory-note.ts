/**
 * Memory Note
 *
 * Core memory note implementation for the Agentic Memory system
 */

import { randomUUID } from 'crypto';
import type { MemoryNote as IMemoryNote, MemoryEvolution } from './types.js';
import { DEFAULT_CONFIG, VALIDATION_RULES } from './constants.js';

/**
 * Memory Note class representing a single unit of information
 */
export class MemoryNote implements IMemoryNote {
	public readonly id: string;
	public content: string;
	public keywords: string[];
	public context: string;
	public tags: string[];
	public links: string[];
	public category: string;
	public timestamp: string;
	public lastAccessed: string;
	public retrievalCount: number;
	public evolutionHistory: MemoryEvolution[];
	public metadata: Record<string, any> | undefined;

	constructor(options: {
		content: string;
		id?: string;
		keywords?: string[] | undefined;
		context?: string | undefined;
		tags?: string[] | undefined;
		links?: string[] | undefined;
		category?: string | undefined;
		timestamp?: string | undefined;
		lastAccessed?: string | undefined;
		retrievalCount?: number;
		evolutionHistory?: MemoryEvolution[];
		metadata?: Record<string, any> | undefined;
	}) {
		// Validate content
		this.validateContent(options.content);

		this.id = options.id || randomUUID();
		this.content = options.content;
		this.keywords = options.keywords || [];
		this.context = options.context || DEFAULT_CONFIG.DEFAULT_CONTEXT;
		this.tags = options.tags || [];
		this.links = options.links || [];
		this.category = options.category || DEFAULT_CONFIG.DEFAULT_CATEGORY;

		const currentTime = this.getCurrentTimestamp();
		this.timestamp = options.timestamp || currentTime;
		this.lastAccessed = options.lastAccessed || currentTime;
		this.retrievalCount = options.retrievalCount || 0;
		this.evolutionHistory = options.evolutionHistory || [];
		this.metadata = options.metadata;

		// Validate all fields
		this.validateFields();
	}

	/**
	 * Create a new memory note from content
	 */
	static create(
		content: string,
		options?: {
			keywords?: string[];
			context?: string;
			tags?: string[];
			category?: string;
			metadata?: Record<string, any> | undefined;
		}
	): MemoryNote {
		return new MemoryNote({
			content,
			keywords: options?.keywords,
			context: options?.context,
			tags: options?.tags,
			category: options?.category,
			metadata: options?.metadata,
		});
	}

	/**
	 * Create a memory note from a plain object
	 */
	static fromObject(obj: any): MemoryNote {
		return new MemoryNote({
			content: obj.content,
			id: obj.id,
			keywords: obj.keywords,
			context: obj.context,
			tags: obj.tags,
			links: obj.links,
			category: obj.category,
			timestamp: obj.timestamp,
			lastAccessed: obj.lastAccessed,
			retrievalCount: obj.retrievalCount,
			evolutionHistory: obj.evolutionHistory,
			metadata: obj.metadata,
		});
	}

	/**
	 * Convert to plain object for serialization
	 */
	toObject(): IMemoryNote {
		return {
			id: this.id,
			content: this.content,
			keywords: this.keywords,
			context: this.context,
			tags: this.tags,
			links: this.links,
			category: this.category,
			timestamp: this.timestamp,
			lastAccessed: this.lastAccessed,
			retrievalCount: this.retrievalCount,
			evolutionHistory: this.evolutionHistory,
			metadata: this.metadata,
		};
	}

	/**
	 * Convert to JSON string
	 */
	toJSON(): string {
		return JSON.stringify(this.toObject());
	}

	/**
	 * Create from JSON string
	 */
	static fromJSON(json: string): MemoryNote {
		const obj = JSON.parse(json);
		return MemoryNote.fromObject(obj);
	}

	/**
	 * Update the memory note content
	 */
	updateContent(content: string): void {
		this.validateContent(content);
		this.content = content;
		this.touch();
	}

	/**
	 * Update keywords
	 */
	updateKeywords(keywords: string[]): void {
		this.validateKeywords(keywords);
		this.keywords = keywords;
		this.touch();
	}

	/**
	 * Update context
	 */
	updateContext(context: string): void {
		this.validateContext(context);
		this.context = context;
		this.touch();
	}

	/**
	 * Update tags
	 */
	updateTags(tags: string[]): void {
		this.validateTags(tags);
		this.tags = tags;
		this.touch();
	}

	/**
	 * Update category
	 */
	updateCategory(category: string): void {
		this.validateCategory(category);
		this.category = category;
		this.touch();
	}

	/**
	 * Add a link to another memory
	 */
	addLink(memoryId: string): void {
		if (!this.links.includes(memoryId)) {
			this.links.push(memoryId);
			this.touch();
		}
	}

	/**
	 * Remove a link to another memory
	 */
	removeLink(memoryId: string): void {
		const index = this.links.indexOf(memoryId);
		if (index > -1) {
			this.links.splice(index, 1);
			this.touch();
		}
	}

	/**
	 * Check if this memory is linked to another
	 */
	isLinkedTo(memoryId: string): boolean {
		return this.links.includes(memoryId);
	}

	/**
	 * Add keywords
	 */
	addKeywords(keywords: string[]): void {
		const newKeywords = keywords.filter(k => !this.keywords.includes(k));
		if (newKeywords.length > 0) {
			this.keywords.push(...newKeywords);
			this.validateKeywords(this.keywords);
			this.touch();
		}
	}

	/**
	 * Add tags
	 */
	addTags(tags: string[]): void {
		const newTags = tags.filter(t => !this.tags.includes(t));
		if (newTags.length > 0) {
			this.tags.push(...newTags);
			this.validateTags(this.tags);
			this.touch();
		}
	}

	/**
	 * Record memory access
	 */
	accessed(): void {
		this.retrievalCount++;
		this.lastAccessed = this.getCurrentTimestamp();
	}

	/**
	 * Add evolution history entry
	 */
	addEvolution(evolution: MemoryEvolution): void {
		this.evolutionHistory.push(evolution);
		this.touch();
	}

	/**
	 * Update metadata
	 */
	updateMetadata(metadata: Record<string, any>): void {
		this.metadata = { ...this.metadata, ...metadata };
		this.touch();
	}

	/**
	 * Get memory age in milliseconds
	 */
	getAge(): number {
		const timestampMs = this.parseTimestamp(this.timestamp);
		return Date.now() - timestampMs;
	}

	/**
	 * Get time since last access in milliseconds
	 */
	getTimeSinceLastAccess(): number {
		const lastAccessMs = this.parseTimestamp(this.lastAccessed);
		return Date.now() - lastAccessMs;
	}

	/**
	 * Check if memory has been evolved
	 */
	hasEvolved(): boolean {
		return this.evolutionHistory.length > 0;
	}

	/**
	 * Get latest evolution
	 */
	getLatestEvolution(): MemoryEvolution | null {
		if (this.evolutionHistory.length === 0) return null;
		return this.evolutionHistory[this.evolutionHistory.length - 1] || null;
	}

	/**
	 * Get evolution count by type
	 */
	getEvolutionCount(type?: string): number {
		if (!type) return this.evolutionHistory.length;
		return this.evolutionHistory.filter(e => e.type === type).length;
	}

	/**
	 * Touch the memory (update last accessed)
	 */
	private touch(): void {
		this.lastAccessed = this.getCurrentTimestamp();
	}

	/**
	 * Get current timestamp in YYYYMMDDHHMM format
	 */
	private getCurrentTimestamp(): string {
		const now = new Date();
		const year = now.getFullYear().toString();
		const month = (now.getMonth() + 1).toString().padStart(2, '0');
		const day = now.getDate().toString().padStart(2, '0');
		const hour = now.getHours().toString().padStart(2, '0');
		const minute = now.getMinutes().toString().padStart(2, '0');
		return `${year}${month}${day}${hour}${minute}`;
	}

	/**
	 * Parse timestamp to milliseconds
	 */
	private parseTimestamp(timestamp: string): number {
		if (timestamp.length !== 12) {
			throw new Error('Invalid timestamp format');
		}

		const year = parseInt(timestamp.substring(0, 4));
		const month = parseInt(timestamp.substring(4, 6)) - 1; // Month is 0-indexed
		const day = parseInt(timestamp.substring(6, 8));
		const hour = parseInt(timestamp.substring(8, 10));
		const minute = parseInt(timestamp.substring(10, 12));

		return new Date(year, month, day, hour, minute).getTime();
	}

	/**
	 * Validate content
	 */
	private validateContent(content: string): void {
		if (!content || typeof content !== 'string') {
			throw new Error('Content is required and must be a string');
		}

		if (content.length < VALIDATION_RULES.MIN_CONTENT_LENGTH) {
			throw new Error(`Content must be at least ${VALIDATION_RULES.MIN_CONTENT_LENGTH} characters`);
		}

		if (content.length > VALIDATION_RULES.MAX_CONTENT_LENGTH) {
			throw new Error(
				`Content must be no more than ${VALIDATION_RULES.MAX_CONTENT_LENGTH} characters`
			);
		}
	}

	/**
	 * Validate keywords
	 */
	private validateKeywords(keywords: string[]): void {
		if (!Array.isArray(keywords)) {
			throw new Error('Keywords must be an array');
		}

		if (keywords.length > VALIDATION_RULES.MAX_KEYWORDS) {
			throw new Error(`Cannot have more than ${VALIDATION_RULES.MAX_KEYWORDS} keywords`);
		}

		for (const keyword of keywords) {
			if (typeof keyword !== 'string') {
				throw new Error('All keywords must be strings');
			}
		}
	}

	/**
	 * Validate tags
	 */
	private validateTags(tags: string[]): void {
		if (!Array.isArray(tags)) {
			throw new Error('Tags must be an array');
		}

		if (tags.length > VALIDATION_RULES.MAX_TAGS) {
			throw new Error(`Cannot have more than ${VALIDATION_RULES.MAX_TAGS} tags`);
		}

		for (const tag of tags) {
			if (typeof tag !== 'string') {
				throw new Error('All tags must be strings');
			}
		}
	}

	/**
	 * Validate context
	 */
	private validateContext(context: string): void {
		if (typeof context !== 'string') {
			throw new Error('Context must be a string');
		}

		if (context.length > VALIDATION_RULES.MAX_CONTEXT_LENGTH) {
			throw new Error(
				`Context must be no more than ${VALIDATION_RULES.MAX_CONTEXT_LENGTH} characters`
			);
		}
	}

	/**
	 * Validate category
	 */
	private validateCategory(category: string): void {
		if (typeof category !== 'string') {
			throw new Error('Category must be a string');
		}

		if (category.length > VALIDATION_RULES.MAX_CATEGORY_LENGTH) {
			throw new Error(
				`Category must be no more than ${VALIDATION_RULES.MAX_CATEGORY_LENGTH} characters`
			);
		}
	}

	/**
	 * Validate all fields
	 */
	private validateFields(): void {
		this.validateContent(this.content);
		this.validateKeywords(this.keywords);
		this.validateTags(this.tags);
		this.validateContext(this.context);
		this.validateCategory(this.category);
	}
}
