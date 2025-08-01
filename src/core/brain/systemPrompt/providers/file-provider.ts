/**
 * File-based Prompt Provider
 *
 * Provides content loaded from external files.
 * Useful for large prompt templates, external instructions, or version-controlled prompts.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { ProviderType, ProviderContext } from '../interfaces.js';
import { BasePromptProvider } from './base-provider.js';

export interface FileProviderConfig {
	/** Path to the file to load (relative or absolute) */
	filePath: string;
	/** Base directory for relative paths */
	baseDir?: string;
	/** Whether to watch file for changes and reload */
	watchForChanges?: boolean;
	/** Encoding for file reading */
	encoding?: string;
	/** Template variables to replace in file content */
	variables?: Record<string, string>;
	/** Whether to summarize the file content using an LLM */
	summarize?: boolean;
}

export class FilePromptProvider extends BasePromptProvider {
	private filePath: string = '';
	private baseDir: string = '';
	private watchForChanges: boolean = false;
	private encoding: string = 'utf8';
	private variables: Record<string, string> = {};
	private cachedContent: string = '';
	private lastModified: Date = new Date(0);

	constructor(id: string, name: string, priority: number, enabled: boolean = true) {
		super(id, name, ProviderType.FILE_BASED, priority, enabled);
	}

	public override validateConfig(config: Record<string, any>): boolean {
		if (!super.validateConfig(config)) {
			return false;
		}

		const typedConfig = config as FileProviderConfig;

		// File path is required and must be a string
		if (typeof typedConfig.filePath !== 'string' || !typedConfig.filePath.trim()) {
			return false;
		}

		// Base directory is optional but must be a string if provided
		if (typedConfig.baseDir !== undefined) {
			if (typeof typedConfig.baseDir !== 'string') {
				return false;
			}
		}

		// Watch for changes is optional but must be a boolean if provided
		if (typedConfig.watchForChanges !== undefined) {
			if (typeof typedConfig.watchForChanges !== 'boolean') {
				return false;
			}
		}

		// Encoding is optional but must be a valid encoding if provided
		if (typedConfig.encoding !== undefined) {
			if (typeof typedConfig.encoding !== 'string') {
				return false;
			}
		}

		// Variables are optional but must be a record if provided
		if (typedConfig.variables !== undefined) {
			if (typeof typedConfig.variables !== 'object' || typedConfig.variables === null) {
				return false;
			}

			// Check that all variable values are strings
			for (const [key, value] of Object.entries(typedConfig.variables)) {
				if (typeof key !== 'string' || typeof value !== 'string') {
					return false;
				}
			}
		}

		// Summarize is optional but must be a boolean if provided
		if (typedConfig.summarize !== undefined) {
			if (typeof typedConfig.summarize !== 'boolean') {
				return false;
			}
		}

		return true;
	}

	public override async initialize(config: Record<string, any>): Promise<void> {
		await super.initialize(config);

		const typedConfig = config as FileProviderConfig;
		this.filePath = typedConfig.filePath;
		this.baseDir = typedConfig.baseDir || process.cwd();
		this.watchForChanges = typedConfig.watchForChanges || false;
		this.encoding = typedConfig.encoding || 'utf8';
		this.variables = typedConfig.variables || {};

		// Load initial content
		await this.loadFileContent();
	}

	public async generateContent(context: ProviderContext): Promise<string> {
		this.ensureInitialized();

		if (!this.canGenerate()) {
			return '';
		}

		// Reload content if watching for changes
		if (this.watchForChanges) {
			await this.checkAndReloadFile();
		}

		// Replace template variables if any exist
		let result = this.cachedContent;
		for (const [key, value] of Object.entries(this.variables)) {
			const placeholder = `{{${key}}}`;
			result = result.replace(new RegExp(placeholder, 'g'), value);
		}

		// Summarization support
		const summarize =
			(this as any).config?.summarize === true || (context as any)?.summarize === true;
		if (summarize) {
			// Use LLM service from context
			const llmService = context?.metadata?.llmService;
			if (!llmService) {
				return '[LLM service unavailable: cannot summarize file]';
			}
			// Cache summary for this file content
			if ((this as any)._cachedSummary && (this as any)._cachedSummarySource === result) {
				return (this as any)._cachedSummary;
			}
			const prompt = `Summarize the following project document for the system prompt. Focus on key guidelines, rules, and standards. Keep the summary concise, maximum 4-5 sentences.\n\n${result}\n\nSummary:`;
			const summary = await llmService.directGenerate(prompt);
			(this as any)._cachedSummary = summary;
			(this as any)._cachedSummarySource = result;
			return summary;
		}

		return result;
	}

	public override async destroy(): Promise<void> {
		await super.destroy();
		this.filePath = '';
		this.baseDir = '';
		this.watchForChanges = false;
		this.encoding = 'utf8';
		this.variables = {};
		this.cachedContent = '';
		this.lastModified = new Date(0);
	}

	/**
	 * Get the full file path (resolves relative paths)
	 */
	private getFullPath(): string {
		if (path.isAbsolute(this.filePath)) {
			return this.filePath;
		}
		return path.resolve(this.baseDir, this.filePath);
	}

	/**
	 * Load file content and cache it
	 */
	private async loadFileContent(): Promise<void> {
		try {
			const fullPath = this.getFullPath();

			// Check if file exists
			const stats = await fs.stat(fullPath);
			this.lastModified = stats.mtime;

			// Read file content
			this.cachedContent = await fs.readFile(fullPath, 'utf8');
		} catch (error) {
			throw new Error(
				`Failed to load file ${this.filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Check if file has been modified and reload if necessary
	 */
	private async checkAndReloadFile(): Promise<void> {
		try {
			const fullPath = this.getFullPath();
			const stats = await fs.stat(fullPath);

			// If file has been modified, reload it
			if (stats.mtime > this.lastModified) {
				await this.loadFileContent();
			}
		} catch (error) {
			// File might have been deleted or become inaccessible
			// Keep using cached content and log the error
			console.warn(
				`Failed to check file ${this.filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}
}
