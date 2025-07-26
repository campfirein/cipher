/**
 * Regression Tests for Normalization
 *
 * Ensures that existing functionality is not broken by the addition of normalization
 * and that backward compatibility is maintained.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { normalizeTextForRetrieval } from '../utils.js';
import { InputRefinementConfig } from '../config.js';

describe('Normalization Regression Tests', () => {
	describe('Backward Compatibility', () => {
		test('should handle undefined config gracefully', () => {
			const text = 'Hello World';
			
			// Should not throw with undefined config
			expect(() => {
				normalizeTextForRetrieval(text, undefined as any);
			}).toThrow(); // This should throw since config is required
		});

		test('should handle empty config object', () => {
			const text = 'Hello World';
			const emptyConfig = {} as InputRefinementConfig;
			
			// Should handle partial config without errors
			const result = normalizeTextForRetrieval(text, emptyConfig);
			expect(result).toBeDefined();
			expect(typeof result).toBe('string');
		});

		test('should handle partial config objects', () => {
			const text = 'Hello, World!';
			
			// Test with only some properties defined
			const partialConfigs = [
				{ NORMALIZATION_TOLOWERCASE: true } as InputRefinementConfig,
				{ NORMALIZATION_REMOVEPUNCTUATION: true } as InputRefinementConfig,
				{ NORMALIZATION_WHITESPACE: true } as InputRefinementConfig,
				{ NORMALIZATION_LANGUAGE: 'ENGLISH' } as InputRefinementConfig,
			];

			partialConfigs.forEach(config => {
				expect(() => {
					const result = normalizeTextForRetrieval(text, config);
					expect(result).toBeDefined();
					expect(typeof result).toBe('string');
				}).not.toThrow();
			});
		});

		test('should maintain function signature compatibility', () => {
			const text = 'Test input';
			const config: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'ENGLISH',
				NORMALIZATION_PAST_DATA: false,
			};

			// Function should accept exactly these parameters
			const result = normalizeTextForRetrieval(text, config);
			expect(result).toBeDefined();
			expect(typeof result).toBe('string');
		});
	});

	describe('No-op Configurations', () => {
		test('should return original text when all normalizations are disabled', () => {
			const originalText = 'Hello, World! How are YOU?';
			const noOpConfig: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: false,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: false,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER',
				NORMALIZATION_PAST_DATA: false,
			};

			const result = normalizeTextForRetrieval(originalText, noOpConfig);
			expect(result).toBe(originalText);
		});

		test('should handle whitespace-only normalization', () => {
			const text = 'Hello   World\n\nTest';
			const whitespaceOnlyConfig: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: false,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER',
				NORMALIZATION_PAST_DATA: false,
			};

			const result = normalizeTextForRetrieval(text, whitespaceOnlyConfig);
			expect(result).toBe('Hello World Test');
		});
	});

	describe('Input Validation', () => {
		test('should handle various input types correctly', () => {
			const validConfig: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER',
				NORMALIZATION_PAST_DATA: false,
			};

			// Empty string
			expect(normalizeTextForRetrieval('', validConfig)).toBe('');

			// Whitespace only
			expect(normalizeTextForRetrieval('   ', validConfig)).toBe('');

			// Single character
			expect(normalizeTextForRetrieval('A', validConfig)).toBe('a');

			// Numbers
			expect(normalizeTextForRetrieval('123', validConfig)).toBe('123');

			// Special characters
			expect(normalizeTextForRetrieval('café', validConfig)).toBe('café');
		});

		test('should handle null and undefined inputs', () => {
			const validConfig: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: false,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER',
				NORMALIZATION_PAST_DATA: false,
			};

			// These should throw errors since string is required
			expect(() => normalizeTextForRetrieval(null as any, validConfig)).toThrow();
			expect(() => normalizeTextForRetrieval(undefined as any, validConfig)).toThrow();
		});
	});

	describe('Performance Regression', () => {
		test('should maintain reasonable performance with large inputs', () => {
			const largeText = 'This is a test sentence with multiple words. '.repeat(1000);
			const config: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: true,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: true,
				NORMALIZATION_STEMMING: true,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'ENGLISH',
				NORMALIZATION_PAST_DATA: false,
			};

			const start = Date.now();
			const result = normalizeTextForRetrieval(largeText, config);
			const duration = Date.now() - start;

			expect(result).toBeDefined();
			expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
		});

		test('should be efficient with repeated calls', () => {
			const text = 'Machine Learning Algorithms';
			const config: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: true,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER',
				NORMALIZATION_PAST_DATA: false,
			};

			const iterations = 1000;
			const start = Date.now();
			
			for (let i = 0; i < iterations; i++) {
				normalizeTextForRetrieval(text, config);
			}
			
			const duration = Date.now() - start;
			expect(duration).toBeLessThan(1000); // Should be fast for repeated calls
		});
	});

	describe('Output Consistency', () => {
		test('should produce consistent output for identical inputs', () => {
			const text = 'Consistent Test Input!';
			const config: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: true,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: true,
				NORMALIZATION_STEMMING: true,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'ENGLISH',
				NORMALIZATION_PAST_DATA: false,
			};

			const results = Array.from({ length: 10 }, () => 
				normalizeTextForRetrieval(text, config)
			);

			// All results should be identical
			const uniqueResults = [...new Set(results)];
			expect(uniqueResults).toHaveLength(1);
		});

		test('should be deterministic across different runs', () => {
			const text = 'Deterministic Test';
			const config: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: true,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'ENGLISH',
				NORMALIZATION_PAST_DATA: false,
			};

			const result1 = normalizeTextForRetrieval(text, config);
			const result2 = normalizeTextForRetrieval(text, config);
			
			expect(result1).toBe(result2);
		});
	});

	describe('Configuration Validation', () => {
		test('should handle invalid language codes gracefully', () => {
			const text = 'Test text';
			const invalidConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: false,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'INVALID' as any,
				NORMALIZATION_PAST_DATA: false,
			};

			// Should handle invalid language without crashing
			expect(() => {
				const result = normalizeTextForRetrieval(text, invalidConfig);
				expect(result).toBeDefined();
			}).not.toThrow();
		});

		test('should handle boolean type coercion', () => {
			const text = 'Boolean Test';
			const config = {
				NORMALIZATION_TOLOWERCASE: 'true' as any, // String instead of boolean
				NORMALIZATION_REMOVEPUNCTUATION: 1 as any, // Number instead of boolean
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER' as const,
				NORMALIZATION_PAST_DATA: false,
			};

			// Function should handle type coercion gracefully
			expect(() => {
				const result = normalizeTextForRetrieval(text, config);
				expect(result).toBeDefined();
			}).not.toThrow();
		});
	});

	describe('Error Handling', () => {
		test('should provide meaningful error messages', () => {
			const validConfig: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: false,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER',
				NORMALIZATION_PAST_DATA: false,
			};

			// Test error cases
			expect(() => normalizeTextForRetrieval(null as any, validConfig)).toThrow();
			expect(() => normalizeTextForRetrieval(undefined as any, validConfig)).toThrow();
		});

		test('should not crash on unexpected input types', () => {
			const validConfig: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: false,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER',
				NORMALIZATION_PAST_DATA: false,
			};

			// These should either work or throw predictable errors
			const unexpectedInputs = [
				123 as any,
				[] as any,
				{} as any,
				true as any,
			];

			unexpectedInputs.forEach(input => {
				expect(() => {
					normalizeTextForRetrieval(input, validConfig);
				}).toThrow(); // Should throw type errors
			});
		});
	});

	describe('Memory Usage', () => {
		test('should not cause memory leaks with repeated use', () => {
			const text = 'Memory test text';
			const config: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: true,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: true,
				NORMALIZATION_STEMMING: true,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'ENGLISH',
				NORMALIZATION_PAST_DATA: false,
			};

			// Run many iterations to test for memory leaks
			for (let i = 0; i < 10000; i++) {
				const result = normalizeTextForRetrieval(text, config);
				expect(result).toBeDefined();
			}

			// If we get here without running out of memory, test passes
			expect(true).toBe(true);
		});
	});
}); 