/**
 * Integration Tests for Normalization in Storage
 *
 * Ensures that data is correctly normalized before being passed to the
 * embedding and storage pipeline.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizeTextForRetrieval } from '../utils.js';
import { type InputRefinementConfig } from '../config.js';
import { VectorStoreManager } from '../../../vector_storage/manager.js';
import { VectorStore } from '../../../vector_storage/types.js';

describe('Normalization in Storage Pipeline', () => {
	let standardConfig: InputRefinementConfig;
	let manager: VectorStoreManager;
	let store: VectorStore | null;

	beforeEach(async () => {
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
		manager = new VectorStoreManager({
			type: 'in-memory',
			collectionName: 'test-storage',
			dimension: 3,
		});
		await manager.connect();
		store = manager.getStore();
	});

	afterEach(async () => {
		await manager.disconnect();
	});

	test('should normalize text before storage', async () => {
		const text = 'The running dogs are jumping.';
		const normalized = normalizeTextForRetrieval(text, standardConfig);

		await store?.insert([[0.1, 0.2, 0.3]], [1], [{ content: normalized }]);
		const stored = await store?.get(1);

		expect(stored).toBeDefined();
		if (typeof stored?.payload?.content === 'string') {
			expect(stored.payload.content.length).toBeLessThan(text.length);
			expect(stored.payload.content).toBe('run dog jump');
		}
	});

	test('should produce consistent storage-ready output', async () => {
		const text = 'The Running Dogs Are Jumping!';
		const normalized = normalizeTextForRetrieval(text, standardConfig);

		await store?.insert([[0.1, 0.2, 0.3]], [2], [{ content: normalized }]);
		const storedValue = await store?.get(2);

		expect(storedValue?.payload?.content).toBe('run dog jump');
	});

	test('should handle empty input for storage', async () => {
		const text = ' ';
		const normalized = normalizeTextForRetrieval(text, standardConfig);

		await store?.insert([[0.1, 0.2, 0.3]], [3], [{ content: normalized }]);
		const storedValue = await store?.get(3);

		expect(storedValue?.payload?.content).toBe('');
	});

	test('should work with different normalization configs for storage', async () => {
		const text = 'Working in the morning';
		const config = {
			...standardConfig,
			NORMALIZATION_STOPWORDS: false,
		};
		const result = normalizeTextForRetrieval(text, config);

		await store?.insert([[0.1, 0.2, 0.3]], [4], [{ content: result }]);
		const storedValue = await store?.get(4);

		expect(storedValue?.payload?.content).toBe('work in the morn');
	});
});