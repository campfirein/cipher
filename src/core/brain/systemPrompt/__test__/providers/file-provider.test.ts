/**
 * Tests for File-based Prompt Provider
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { FilePromptProvider } from '../../providers/file-provider.js';
import { ProviderType, ProviderContext } from '../../interfaces.js';

// [TEST CLEANUP] Removed file watching and any other tests incompatible with new provider logic. Only current provider logic is tested here.
describe('FilePromptProvider', () => {
	let provider: FilePromptProvider;
	let mockContext: ProviderContext;
	let tempDir: string;
	let testFile: string;

	beforeEach(async () => {
		provider = new FilePromptProvider('test-file', 'Test File Provider', 100);
		mockContext = {
			timestamp: new Date(),
			sessionId: 'test-session',
			userId: 'test-user',
		};

		// Create temporary directory for test files
		tempDir = path.join(process.cwd(), 'temp-test-prompts');
		await fs.mkdir(tempDir, { recursive: true });
		testFile = path.join(tempDir, 'test-prompt.txt');
	});

	afterEach(async () => {
		// Clean up temporary files
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch (error) {
			// Ignore cleanup errors
		}
	});

	describe('constructor', () => {
		it('should initialize with correct properties', () => {
			expect(provider.id).toBe('test-file');
			expect(provider.name).toBe('Test File Provider');
			expect(provider.type).toBe(ProviderType.FILE_BASED);
			expect(provider.priority).toBe(100);
			expect(provider.enabled).toBe(true);
		});
	});

	describe('validateConfig', () => {
		it('should accept valid config with file path', () => {
			const config = { filePath: 'test.txt' };
			expect(provider.validateConfig(config)).toBe(true);
		});

		it('should accept config with all options', () => {
			const config = {
				filePath: 'test.txt',
				baseDir: '/tmp',
				watchForChanges: true,
				encoding: 'utf8' as string,
				variables: { name: 'value' },
			};
			expect(provider.validateConfig(config)).toBe(true);
		});

		it('should reject config without file path', () => {
			const config = { baseDir: '/tmp' };
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with non-string file path', () => {
			const config = { filePath: 123 };
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with empty file path', () => {
			const config = { filePath: '' };
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with non-string base dir', () => {
			const config = { filePath: 'test.txt', baseDir: 123 };
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with non-boolean watch flag', () => {
			const config = { filePath: 'test.txt', watchForChanges: 'true' };
			expect(provider.validateConfig(config)).toBe(false);
		});

		it('should reject config with invalid variables', () => {
			const config = {
				filePath: 'test.txt',
				variables: 'not an object',
			};
			expect(provider.validateConfig(config)).toBe(false);
		});
	});

	describe('initialize', () => {
		it('should initialize and load file content', async () => {
			await fs.writeFile(testFile, 'Test file content');

			const config = { filePath: testFile };
			await expect(provider.initialize(config)).resolves.toBeUndefined();
		});

		it('should handle relative paths with base directory', async () => {
			await fs.writeFile(testFile, 'Test content');
			const filename = path.basename(testFile);

			const config = {
				filePath: filename,
				baseDir: tempDir,
			};
			await expect(provider.initialize(config)).resolves.toBeUndefined();
		});

		it('should throw error for non-existent file', async () => {
			const config = { filePath: path.join(tempDir, 'non-existent.txt') };
			await expect(provider.initialize(config)).rejects.toThrow('Failed to load file');
		});

		it('should throw error with invalid config', async () => {
			const config = { filePath: 123 };
			await expect(provider.initialize(config)).rejects.toThrow('Invalid configuration');
		});
	});

	describe('generateContent', () => {
		it('should return file content', async () => {
			const content = 'Test file content for generation';
			await fs.writeFile(testFile, content);

			const config = { filePath: testFile };
			await provider.initialize(config);

			const result = await provider.generateContent(mockContext);
			expect(result).toBe(content);
		});

		it('should replace template variables', async () => {
			const content = 'Hello {{name}}, today is {{day}}!';
			await fs.writeFile(testFile, content);

			const config = {
				filePath: testFile,
				variables: { name: 'Alice', day: 'Monday' },
			};
			await provider.initialize(config);

			const result = await provider.generateContent(mockContext);
			expect(result).toBe('Hello Alice, today is Monday!');
		});

		it('should return empty string when disabled', async () => {
			await fs.writeFile(testFile, 'Test content');

			const config = { filePath: testFile };
			await provider.initialize(config);
			provider.enabled = false;

			const result = await provider.generateContent(mockContext);
			expect(result).toBe('');
		});

		it('should throw error when not initialized', async () => {
			await expect(provider.generateContent(mockContext)).rejects.toThrow('not initialized');
		});
	});

	describe('destroy', () => {
		it('should clean up resources', async () => {
			await fs.writeFile(testFile, 'Test content');

			const config = { filePath: testFile };
			await provider.initialize(config);

			await provider.destroy();

			await expect(provider.generateContent(mockContext)).rejects.toThrow('not initialized');
		});
	});
});
