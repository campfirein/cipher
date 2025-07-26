/**
 * Unit Tests for Embedding Utils - Normalization
 *
 * Tests the normalizeTextForRetrieval function covering:
 * - All normalization steps (lowercase, punctuation, whitespace, stopwords, stemming)
 * - Edge cases (empty strings, special characters, mixed content)
 * - Configuration combinations
 * - Performance with large inputs
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { normalizeTextForRetrieval } from '../utils.js';
import { InputRefinementConfig } from '../config.js';

describe('normalizeTextForRetrieval', () => {
	let defaultConfig: InputRefinementConfig;

	beforeEach(() => {
		defaultConfig = {
			NORMALIZATION_TOLOWERCASE: true,
			NORMALIZATION_REMOVEPUNCTUATION: true,
			NORMALIZATION_WHITESPACE: true,
			NORMALIZATION_STOPWORDS: true,
			NORMALIZATION_STEMMING: true,
			NORMALIZATION_LEMMATIZATION: false,
			NORMALIZATION_LANGUAGE: 'ENGLISH',
			NORMALIZATION_PAST_DATA: false,
		};
	});

	describe('Basic Normalization Steps', () => {
		test('should convert text to lowercase when enabled', () => {
			const config = { ...defaultConfig, NORMALIZATION_TOLOWERCASE: true };
			const result = normalizeTextForRetrieval('Hello WORLD!', config);
			expect(result.toLowerCase()).toBe(result);
		});

		test('should preserve case when lowercase normalization is disabled', () => {
			const config = { 
				...defaultConfig, 
				NORMALIZATION_TOLOWERCASE: false,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: false,
				NORMALIZATION_LANGUAGE: 'OTHER' as const
			};
			const result = normalizeTextForRetrieval('Hello WORLD!', config);
			expect(result).toBe('Hello WORLD!');
		});

		test('should remove punctuation when enabled', () => {
			const config = { 
				...defaultConfig, 
				NORMALIZATION_REMOVEPUNCTUATION: true,
				NORMALIZATION_LANGUAGE: 'OTHER' as const
			};
			const result = normalizeTextForRetrieval('hello, world! how are you?', config);
			expect(result).not.toContain(',');
			expect(result).not.toContain('!');
			expect(result).not.toContain('?');
		});

		test('should preserve punctuation when removal is disabled', () => {
			const config = { 
				...defaultConfig, 
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER' as const
			};
			const result = normalizeTextForRetrieval('hello, world!', config);
			expect(result).toContain(',');
			expect(result).toContain('!');
		});
	});

	describe('Whitespace Normalization', () => {
		test('should normalize multiple spaces to single space', () => {
			const config = { ...defaultConfig, NORMALIZATION_LANGUAGE: 'OTHER' as const };
			const result = normalizeTextForRetrieval('hello    world     test', config);
			expect(result).toBe('hello world test');
		});

		test('should remove literal \\n strings', () => {
			const config = { ...defaultConfig, NORMALIZATION_LANGUAGE: 'OTHER' as const };
			const result = normalizeTextForRetrieval('hello \\n \\n world', config);
			expect(result).toBe('hello world');
			expect(result).not.toContain('n');
		});

		test('should remove actual line breaks', () => {
			const config = { ...defaultConfig, NORMALIZATION_LANGUAGE: 'OTHER' as const };
			const result = normalizeTextForRetrieval('hello\n\nworld\rtest', config);
			expect(result).toBe('hello world test');
		});

		test('should handle mixed line breaks and literal \\n', () => {
			const config = { ...defaultConfig, NORMALIZATION_LANGUAGE: 'OTHER' as const };
			const result = normalizeTextForRetrieval('hello\\n\nworld\\r\rtest', config);
			expect(result).toBe('hello world test');
		});

		test('should trim leading and trailing whitespace', () => {
			const config = { ...defaultConfig, NORMALIZATION_LANGUAGE: 'OTHER' as const };
			const result = normalizeTextForRetrieval('  hello world  ', config);
			expect(result).toBe('hello world');
		});

		test('should handle whitespace-only input', () => {
			const config = { ...defaultConfig, NORMALIZATION_LANGUAGE: 'OTHER' as const };
			const result = normalizeTextForRetrieval('   \\n \\n   ', config);
			expect(result).toBe('');
		});
	});

	describe('English Language Processing', () => {
		test('should remove English stopwords when enabled', () => {
			const config = { 
				...defaultConfig, 
				NORMALIZATION_STOPWORDS: true,
				NORMALIZATION_STEMMING: false 
			};
			const result = normalizeTextForRetrieval('the quick brown fox', config);
			expect(result).not.toContain('the');
			expect(result).toContain('quick');
			expect(result).toContain('brown');
			expect(result).toContain('fox');
		});

		test('should preserve stopwords when removal is disabled', () => {
			const config = { 
				...defaultConfig, 
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false 
			};
			const result = normalizeTextForRetrieval('the quick brown fox', config);
			expect(result).toContain('the');
		});

		test('should apply stemming when enabled', () => {
			const config = { 
				...defaultConfig, 
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: true 
			};
			const result = normalizeTextForRetrieval('running runner runs', config);
			// Porter stemmer should reduce these to stems
			expect(result.split(' ')).toHaveLength(3);
			// All should have same or similar stem
			const words = result.split(' ');
			expect(words.every(word => word.startsWith('run'))).toBe(true);
		});

		test('should preserve original words when stemming is disabled', () => {
			const config = { 
				...defaultConfig, 
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false 
			};
			const result = normalizeTextForRetrieval('running runner runs', config);
			expect(result).toBe('running runner runs');
		});

		test('should combine stopword removal and stemming', () => {
			const config = { 
				...defaultConfig, 
				NORMALIZATION_STOPWORDS: true,
				NORMALIZATION_STEMMING: true 
			};
			const result = normalizeTextForRetrieval('the running dogs are jumping', config);
			expect(result).not.toContain('the');
			expect(result).not.toContain('are');
			// Should contain stemmed versions
			const words = result.split(' ');
			expect(words.length).toBeGreaterThan(0);
		});
	});

	describe('Configuration Combinations', () => {
		test('should work with all normalizations disabled', () => {
			const config: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: false,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: false,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER' as const,
				NORMALIZATION_PAST_DATA: false,
			};
			const input = 'Hello, World! How are you?';
			const result = normalizeTextForRetrieval(input, config);
			expect(result).toBe(input);
		});

		test('should work with all normalizations enabled', () => {
			const result = normalizeTextForRetrieval('Hello, World! How are you doing?', defaultConfig);
			expect(result).toBe(result.toLowerCase());
			expect(result).not.toContain(',');
			expect(result).not.toContain('!');
			expect(result).not.toContain('?');
			// Should be processed through English language pipeline
			expect(result.length).toBeGreaterThan(0);
		});

		test('should work with only whitespace normalization', () => {
			const config: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: false,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER' as const,
				NORMALIZATION_PAST_DATA: false,
			};
			const result = normalizeTextForRetrieval('Hello   \\n World!', config);
			expect(result).toBe('Hello World!');
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty string', () => {
			const result = normalizeTextForRetrieval('', defaultConfig);
			expect(result).toBe('');
		});

		test('should handle string with only whitespace', () => {
			const result = normalizeTextForRetrieval('   \\n   \\r   ', defaultConfig);
			expect(result).toBe('');
		});

		test('should handle string with only punctuation', () => {
			const config = { ...defaultConfig, NORMALIZATION_LANGUAGE: 'OTHER' as const };
			const result = normalizeTextForRetrieval('!@#$%^&*()', config);
			expect(result).toBe('');
		});

		test('should handle string with only stopwords', () => {
			const result = normalizeTextForRetrieval('the a an and or but', defaultConfig);
			expect(result).toBe('');
		});

		test('should handle very long string', () => {
			const longText = 'word '.repeat(1000);
			const result = normalizeTextForRetrieval(longText, defaultConfig);
			expect(result.length).toBeGreaterThan(0);
			expect(result.length).toBeLessThan(longText.length);
		});

		test('should handle unicode characters', () => {
			const config = { ...defaultConfig, NORMALIZATION_LANGUAGE: 'OTHER' as const };
			const result = normalizeTextForRetrieval('café naïve résumé', config);
			expect(result).toContain('café');
			expect(result).toContain('naïve');
			expect(result).toContain('résumé');
		});

		test('should handle numbers and alphanumeric', () => {
			const config = { ...defaultConfig, NORMALIZATION_LANGUAGE: 'OTHER' as const };
			const result = normalizeTextForRetrieval('test123 word456 789', config);
			expect(result).toContain('test123');
			expect(result).toContain('word456');
			expect(result).toContain('789');
		});

		test('should handle special characters not in punctuation regex', () => {
			const config = { ...defaultConfig, NORMALIZATION_LANGUAGE: 'OTHER' as const };
			const result = normalizeTextForRetrieval('hello±world×test÷result', config);
			expect(result).toContain('±');
			expect(result).toContain('×');
			expect(result).toContain('÷');
		});
	});

	describe('Non-English Language Handling', () => {
		test('should skip English processing when language is not ENGLISH', () => {
			const config = { 
				...defaultConfig, 
				NORMALIZATION_LANGUAGE: 'OTHER' as const 
			};
			const result = normalizeTextForRetrieval('the running dogs', config);
			// Should still do basic normalization but skip English-specific processing
			expect(result).toBe('the running dogs');
		});

		test('should skip English processing when language is OTHER', () => {
			const config = { 
				...defaultConfig, 
				NORMALIZATION_LANGUAGE: 'OTHER' as const 
			};
			const result = normalizeTextForRetrieval('the running dogs', config);
			expect(result).toBe('the running dogs');
		});
	});

	describe('Performance and Robustness', () => {
		test('should handle repeated normalization (idempotent)', () => {
			const input = 'Hello, World! How are you?';
			const result1 = normalizeTextForRetrieval(input, defaultConfig);
			const result2 = normalizeTextForRetrieval(result1, defaultConfig);
			expect(result1).toBe(result2);
		});

		test('should be performant with large input', () => {
			const largeInput = 'This is a test sentence. '.repeat(10000);
			const start = Date.now();
			const result = normalizeTextForRetrieval(largeInput, defaultConfig);
			const duration = Date.now() - start;
			expect(result.length).toBeGreaterThan(0);
			expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
		});

		test('should handle null-like values gracefully', () => {
			// TypeScript should prevent this, but test runtime safety
			expect(() => normalizeTextForRetrieval(null as any, defaultConfig)).toThrow();
			expect(() => normalizeTextForRetrieval(undefined as any, defaultConfig)).toThrow();
		});
	});
}); 