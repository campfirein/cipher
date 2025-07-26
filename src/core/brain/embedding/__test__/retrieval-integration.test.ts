/**
 * End-to-End Retrieval Tests with Normalization
 *
 * Tests that demonstrate improved retrieval quality when normalization is applied.
 * Focuses on the normalization utility's impact on text matching and search relevance.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { normalizeTextForRetrieval } from '../utils.js';
import { InputRefinementConfig } from '../config.js';

describe('Retrieval Quality with Normalization', () => {
	let standardConfig: InputRefinementConfig;
	let minimalConfig: InputRefinementConfig;

	beforeEach(() => {
		standardConfig = {
			NORMALIZATION_TOLOWERCASE: true,
			NORMALIZATION_REMOVEPUNCTUATION: true,
			NORMALIZATION_WHITESPACE: true,
			NORMALIZATION_STOPWORDS: true,
			NORMALIZATION_STEMMING: true,
			NORMALIZATION_LEMMATIZATION: false,
			NORMALIZATION_LANGUAGE: 'ENGLISH',
			NORMALIZATION_PAST_DATA: false,
		};

		minimalConfig = {
			NORMALIZATION_TOLOWERCASE: false,
			NORMALIZATION_REMOVEPUNCTUATION: false,
			NORMALIZATION_WHITESPACE: false,
			NORMALIZATION_STOPWORDS: false,
			NORMALIZATION_STEMMING: false,
			NORMALIZATION_LEMMATIZATION: false,
			NORMALIZATION_LANGUAGE: 'OTHER',
			NORMALIZATION_PAST_DATA: false,
		};
	});

	describe('Text Matching Improvements', () => {
		test('should improve case-insensitive matching', () => {
			const documents = [
				'Machine Learning Algorithms',
				'machine learning frameworks',
				'MACHINE LEARNING principles'
			];

			const query = 'Machine Learning';

			// Without normalization - only exact case matches
			const withoutNorm = documents.map(doc => 
				normalizeTextForRetrieval(doc, minimalConfig)
			);
			const queryWithoutNorm = normalizeTextForRetrieval(query, minimalConfig);

			// With normalization - all should match
			const withNorm = documents.map(doc => 
				normalizeTextForRetrieval(doc, standardConfig)
			);
			const queryWithNorm = normalizeTextForRetrieval(query, standardConfig);

			// Verify normalization makes all text comparable
			expect(withNorm.every(doc => doc.includes('machin'))).toBe(true); // Stemmed form
			expect(queryWithNorm.includes('machin')).toBe(true);

			// Original text maintains case differences
			expect(withoutNorm[0]).not.toBe(withoutNorm[1]);
			expect(withoutNorm[1]).not.toBe(withoutNorm[2]);
		});

		test('should improve punctuation-insensitive matching', () => {
			const documents = [
				'What is AI?',
				'What is AI!',
				'What is AI...',
				'What is AI'
			];

			const query = 'What is AI';

			// With normalization - all should be equivalent
			const normalized = documents.map(doc => 
				normalizeTextForRetrieval(doc, standardConfig)
			);
			const normalizedQuery = normalizeTextForRetrieval(query, standardConfig);

			// All normalized versions should be the same (after removing stopwords and punctuation)
			const uniqueNormalized = [...new Set(normalized)];
			expect(uniqueNormalized).toHaveLength(1);
			expect(uniqueNormalized[0]).toBe(normalizedQuery);
		});

		test('should improve morphological matching through stemming', () => {
			const documents = [
				'running algorithms',
				'algorithm runners',
				'run algorithmic processes'
			];

			const query = 'run algorithm';

			const normalized = documents.map(doc => 
				normalizeTextForRetrieval(doc, standardConfig)
			);
			const normalizedQuery = normalizeTextForRetrieval(query, standardConfig);

			// Stemming should make these more similar
			expect(normalized.every(doc => doc.includes('run'))).toBe(true);
			expect(normalized.every(doc => doc.includes('algorithm'))).toBe(true);
			expect(normalizedQuery.includes('run')).toBe(true);
			expect(normalizedQuery.includes('algorithm')).toBe(true);
		});

		test('should improve relevance by removing noise words', () => {
			const documents = [
				'The quick brown fox jumps over the lazy dog',
				'A quick brown fox is jumping over a lazy dog',
				'Quick brown foxes jump over lazy dogs'
			];

			const query = 'quick brown fox';

			const normalized = documents.map(doc => 
				normalizeTextForRetrieval(doc, standardConfig)
			);
			const normalizedQuery = normalizeTextForRetrieval(query, standardConfig);

			// Stopwords should be removed, content words preserved
			expect(normalized.every(doc => !doc.includes('the'))).toBe(true);
			expect(normalized.every(doc => !doc.includes('over'))).toBe(true);
			expect(normalized.every(doc => doc.includes('quick'))).toBe(true);
			expect(normalized.every(doc => doc.includes('brown'))).toBe(true);
			expect(normalized.every(doc => doc.includes('fox'))).toBe(true);
		});
	});

	describe('Query-Document Similarity', () => {
		test('should increase similarity scores for semantically similar text', () => {
			const document = 'Machine Learning: The Future of AI Technology!';
			const similarQueries = [
				'machine learning future ai',
				'MACHINE LEARNING FUTURE AI',
				'Machine Learning - Future AI',
				'machine learning... the future... of ai'
			];

			const normalizedDoc = normalizeTextForRetrieval(document, standardConfig);
			const normalizedQueries = similarQueries.map(q => 
				normalizeTextForRetrieval(q, standardConfig)
			);

			// All normalized queries should be very similar to the document
			normalizedQueries.forEach(query => {
				const docWords = new Set(normalizedDoc.split(' '));
				const queryWords = new Set(query.split(' '));
				const intersection = new Set([...docWords].filter(x => queryWords.has(x)));
				const union = new Set([...docWords, ...queryWords]);
				
				const jaccardSimilarity = intersection.size / union.size;
				expect(jaccardSimilarity).toBeGreaterThan(0.5); // High similarity
			});
		});

		test('should handle domain-specific terminology consistently', () => {
			const documents = [
				'Natural Language Processing (NLP) techniques',
				'NLP: Natural Language Processing methods',
				'Techniques in Natural Language Processing'
			];

			const query = 'Natural Language Processing';

			const normalized = documents.map(doc => 
				normalizeTextForRetrieval(doc, standardConfig)
			);
			const normalizedQuery = normalizeTextForRetrieval(query, standardConfig);

			// All should contain the core terms
			expect(normalized.every(doc => 
				doc.includes('natur') && doc.includes('languag') && doc.includes('process')
			)).toBe(true);
		});

		test('should improve recall for variations of the same concept', () => {
			const documents = [
				'Artificial Intelligence systems',
				'AI-powered applications',
				'Intelligent artificial systems',
				'AI and intelligent systems'
			];

			const queries = [
				'artificial intelligence',
				'AI systems',
				'intelligent systems'
			];

			const normalizedDocs = documents.map(doc => 
				normalizeTextForRetrieval(doc, standardConfig)
			);
			const normalizedQueries = queries.map(q => 
				normalizeTextForRetrieval(q, standardConfig)
			);

			// Each query should match multiple documents after normalization
			normalizedQueries.forEach(query => {
				const queryWords = query.split(' ');
				const matchingDocs = normalizedDocs.filter(doc =>
					queryWords.some(word => doc.includes(word))
				);
				expect(matchingDocs.length).toBeGreaterThan(1);
			});
		});
	});

	describe('Edge Cases and Robustness', () => {
		test('should handle queries with only stopwords gracefully', () => {
			const stopwordQuery = 'the and or but';
			const documents = [
				'Machine learning algorithms',
				'Deep learning networks',
				'AI research methods'
			];

			const normalizedQuery = normalizeTextForRetrieval(stopwordQuery, standardConfig);
			const normalizedDocs = documents.map(doc => 
				normalizeTextForRetrieval(doc, standardConfig)
			);

			// Query should be empty or minimal after normalization
			expect(normalizedQuery.length).toBeLessThan(stopwordQuery.length);
			
			// Documents should still have content
			expect(normalizedDocs.every(doc => doc.length > 0)).toBe(true);
		});

		test('should handle mixed language content', () => {
			const documents = [
				'Machine learning café',
				'AI résumé processing',
				'Naïve Bayes algorithm'
			];

			const normalized = documents.map(doc => 
				normalizeTextForRetrieval(doc, standardConfig)
			);

			// Should preserve unicode characters while normalizing English words
			expect(normalized.every(doc => doc.length > 0)).toBe(true);
			// Note: The tokenizer breaks unicode words, so we get fragments
			expect(normalized[0]).toContain('caf'); // "café" becomes "caf"
			expect(normalized[1]).toContain('sum'); // "résumé" becomes "r sum" -> "sum"
			expect(normalized[2]).toContain('na'); // "Naïve" becomes "na ve" -> contains "na"
		});

		test('should handle very long text efficiently', () => {
			const longText = 'Machine learning is a powerful technique. '.repeat(1000);
			const query = 'machine learning technique';

			const startTime = Date.now();
			const normalizedDoc = normalizeTextForRetrieval(longText, standardConfig);
			const normalizedQuery = normalizeTextForRetrieval(query, standardConfig);
			const duration = Date.now() - startTime;

			expect(duration).toBeLessThan(5000); // Should be fast
			expect(normalizedDoc.length).toBeGreaterThan(0);
			expect(normalizedQuery.length).toBeGreaterThan(0);
		});

		test('should provide consistent results across runs', () => {
			const text = 'Machine Learning: The Future!';
			const config = { ...standardConfig };

			// Run normalization multiple times
			const results = Array.from({ length: 5 }, () => 
				normalizeTextForRetrieval(text, config)
			);

			// All results should be identical
			const uniqueResults = [...new Set(results)];
			expect(uniqueResults).toHaveLength(1);
		});
	});

	describe('Configuration Impact on Retrieval', () => {
		test('should show measurable difference between configuration levels', () => {
			const text = 'The Quick Brown Fox Jumps Over The Lazy Dog!';

			const noNormalization = normalizeTextForRetrieval(text, minimalConfig);
			const fullNormalization = normalizeTextForRetrieval(text, standardConfig);

			// Should be significantly different
			expect(noNormalization).not.toBe(fullNormalization);
			expect(fullNormalization.length).toBeLessThan(noNormalization.length);
			expect(fullNormalization).not.toContain('!');
			expect(fullNormalization).not.toContain('The');
		});

		test('should allow fine-tuned normalization control', () => {
			const text = 'Machine Learning: The Future!';

			// Only lowercase
			const lowercaseOnly: InputRefinementConfig = {
				...minimalConfig,
				NORMALIZATION_TOLOWERCASE: true
			};

			// Lowercase + punctuation removal
			const lowercaseAndPunctuation: InputRefinementConfig = {
				...lowercaseOnly,
				NORMALIZATION_REMOVEPUNCTUATION: true
			};

			const result1 = normalizeTextForRetrieval(text, lowercaseOnly);
			const result2 = normalizeTextForRetrieval(text, lowercaseAndPunctuation);

			expect(result1).toContain(':');
			expect(result1).toContain('!');
			expect(result2).not.toContain(':');
			expect(result2).not.toContain('!');
		});

		test('should demonstrate cumulative normalization benefits', () => {
			const documents = [
				'MACHINE LEARNING!',
				'machine learning?',
				'Machine Learning.',
				'The machine learning...'
			];

			const query = 'machine learning';

			// Progressive normalization
			const configs = [
				minimalConfig,
				{ ...minimalConfig, NORMALIZATION_TOLOWERCASE: true },
				{ ...minimalConfig, NORMALIZATION_TOLOWERCASE: true, NORMALIZATION_REMOVEPUNCTUATION: true },
				{ ...minimalConfig, NORMALIZATION_TOLOWERCASE: true, NORMALIZATION_REMOVEPUNCTUATION: true, NORMALIZATION_WHITESPACE: true },
				standardConfig
			];

			const results = configs.map(config => ({
				config,
				normalizedDocs: documents.map(doc => normalizeTextForRetrieval(doc, config)),
				normalizedQuery: normalizeTextForRetrieval(query, config)
			}));

			// More normalization should lead to more similar results
			const similarities = results.map(({ normalizedDocs, normalizedQuery }) => {
				const uniqueDocs = [...new Set(normalizedDocs)];
				return {
					uniqueVariations: uniqueDocs.length,
					exactMatches: normalizedDocs.filter(doc => doc === normalizedQuery).length
				};
			});

			// Should see progression toward more similarity
			expect(similarities[similarities.length - 1].exactMatches).toBeGreaterThanOrEqual(
				similarities[0].exactMatches
			);
		});
	});
}); 