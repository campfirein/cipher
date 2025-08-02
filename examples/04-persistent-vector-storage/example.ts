#!/usr/bin/env node

/**
 * Persistent Vector Storage Example
 * 
 * This example demonstrates how to use the in-memory vector storage
 * with automatic persistence to local files.
 * 
 * Features demonstrated:
 * - Automatic persistence to local files
 * - Data survival across process restarts
 * - Custom persistence paths
 * - Error handling for file operations
 */

import { createPersistentInMemoryStore, createVectorStore } from '../../src/core/vector_storage/factory.js';
import { createLogger } from '../../src/core/logger/index.js';

const logger = createLogger();

async function demonstratePersistence() {
	console.log('🚀 Persistent Vector Storage Example\n');

	// Example 1: Basic persistence with default path
	console.log('📁 Example 1: Basic persistence with default path');
	
	const { manager: manager1, store: store1 } = await createPersistentInMemoryStore('example_collection');
	
	// Add some vectors with metadata (using 1536 dimensions to match default)
	const vectors = [
		Array.from({ length: 1536 }, (_, i) => i % 10),      // Pattern 0-9 repeating
		Array.from({ length: 1536 }, (_, i) => (i + 1) % 10), // Pattern 1-0 repeating
		Array.from({ length: 1536 }, (_, i) => (i + 2) % 10)  // Pattern 2-1 repeating
	];
	
	await store1.insert(
		vectors,
		['doc1', 'doc2', 'doc3'],
		[
			{ title: 'First Document', category: 'docs', created: Date.now() },
			{ title: 'Second Document', category: 'docs', created: Date.now() },
			{ title: 'Third Document', category: 'reports', created: Date.now() }
		]
	);

	console.log('✅ Added 3 vectors with metadata');
	
	// Search for similar vectors
	const queryVector = Array.from({ length: 1536 }, (_, i) => i % 10);
	const results = await store1.search(queryVector, 2);
	console.log('🔍 Search results:', results.length, 'vectors found');
	
	// Disconnect (data is automatically saved)
	await manager1.disconnect();
	console.log('💾 Data saved to default path: ./data/vector-storage\n');

	// Example 2: Custom persistence path with smaller dimension
	console.log('📁 Example 2: Custom persistence path');
	
	const { manager: manager2, store: store2 } = await createPersistentInMemoryStore(
		'custom_collection',
		10,  // smaller dimension for demonstration
		'./example-data/custom-vectors'  // custom path
	);
	
	// Add vectors to custom collection
	const smallVectors = [
		Array.from({ length: 10 }, (_, i) => i),
		Array.from({ length: 10 }, (_, i) => i + 1)
	];
	
	await store2.insert(
		smallVectors,
		['custom1', 'custom2'],
		[
			{ title: 'Custom Document 1', path: 'custom' },
			{ title: 'Custom Document 2', path: 'custom' }
		]
	);
	
	await manager2.disconnect();
	console.log('💾 Data saved to custom path: ./example-data/custom-vectors\n');

	// Example 3: Manual configuration
	console.log('📁 Example 3: Manual configuration');
	
	const config = {
		type: 'in-memory' as const,
		collectionName: 'manual_collection',
		dimension: 8,
		maxVectors: 1000,
		annPersistIndex: true,
		annIndexPath: './example-data/manual-vectors'
	};
	
	const { manager: manager3, store: store3 } = await createVectorStore(config);
	
	const manualVectors = [Array.from({ length: 8 }, (_, i) => i * 2)];
	await store3.insert(
		manualVectors,
		['manual1'],
		[{ title: 'Manual Document', config: 'manual' }]
	);
	
	await manager3.disconnect();
	console.log('💾 Data saved to manual path: ./example-data/manual-vectors\n');

	// Example 4: Demonstrate data persistence across restarts
	console.log('📁 Example 4: Demonstrating data persistence');
	
	// Reconnect to the first collection
	const { manager: manager4, store: store4 } = await createPersistentInMemoryStore('example_collection');
	
	// Try to retrieve the previously saved data
	const doc1 = await store4.get('doc1');
	if (doc1) {
		console.log('✅ Retrieved persisted data:', doc1.payload.title);
	} else {
		console.log('❌ Failed to retrieve persisted data');
	}
	
	// Search in the persisted collection
	const searchResults = await store4.search(queryVector, 3);
	console.log('🔍 Found', searchResults.length, 'persisted vectors');
	
	await manager4.disconnect();
	console.log('✅ Persistence demonstration complete!\n');

	// Example 5: Error handling demonstration
	console.log('📁 Example 5: Error handling demonstration');
	
	try {
		// Try to create a store with a non-writable path
		const { manager: manager5, store: store5 } = await createPersistentInMemoryStore(
			'error_test',
			5,
			'/root/non-writable-path'  // This should fail gracefully
		);
		
		const testVector = Array.from({ length: 5 }, (_, i) => i);
		await store5.insert([testVector], ['test'], [{ title: 'Test' }]);
		await manager5.disconnect();
		
	} catch (error) {
		console.log('⚠️  Gracefully handled file system error (expected)');
	}

	console.log('\n🎉 All examples completed successfully!');
	console.log('\n📋 Summary:');
	console.log('   • Data is automatically saved to local files');
	console.log('   • Data survives process restarts');
	console.log('   • Custom persistence paths are supported');
	console.log('   • File system errors are handled gracefully');
	console.log('   • Default path: ./data/vector-storage');
}

// Run the example
demonstratePersistence().catch(console.error); 