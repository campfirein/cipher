import { PgVectorBackend } from '../backend/pgvector.js';

describe('PgVectorBackend', () => {
	it('should search with all filter types (integration)', async () => {
		// Insert test data
		await backend.insert(
			[
				[1, 2, 3],
				[2, 3, 4],
				[3, 4, 5],
				[4, 5, 6],
				[5, 6, 7],
			],
			[1, 2, 3, 4, 5],
			[
				{
					type: 'A',
					value: 10,
					tags: ['x', 'y'],
					category: 'special',
					sessionId: 's1',
					traceId: 't1',
					timestamp: 100,
				},
				{
					type: 'B',
					value: 3,
					tags: ['y', 'z'],
					category: 'normal',
					sessionId: 's2',
					traceId: 't2',
					timestamp: 200,
				},
				{
					type: 'A',
					value: 15,
					tags: ['x'],
					category: 'special',
					sessionId: 's1',
					traceId: 't3',
					timestamp: 300,
				},
				{
					type: 'C',
					value: 7,
					tags: ['z'],
					category: 'other',
					sessionId: 's3',
					traceId: 't4',
					timestamp: 400,
				},
				{
					type: 'B',
					value: 20,
					tags: ['x', 'z'],
					category: 'normal',
					sessionId: 's2',
					traceId: 't5',
					timestamp: 500,
				},
			]
		);

		// Exact match
		let results = await backend.search([1, 2, 3], 10, { type: 'A' });
		expect(results.some(r => r.payload.type === 'A')).toBe(true);

		// Numeric gte
		results = await backend.search([1, 2, 3], 10, { value: { gte: 15 } });
		expect(results.some(r => r.payload.value >= 15)).toBe(true);

		// Numeric lt
		results = await backend.search([1, 2, 3], 10, { value: { lt: 10 } });
		expect(results.some(r => r.payload.value < 10)).toBe(true);

		// Array match
		results = await backend.search([1, 2, 3], 10, { tags: { any: ['x', 'z'] } });
		expect(
			results.some(
				r =>
					(Array.isArray(r.payload.tags) && r.payload.tags.includes('x')) ||
					r.payload.tags.includes('z')
			)
		).toBe(true);

		// Dedicated column match
		results = await backend.search([1, 2, 3], 10, { category: 'special' });
		expect(results.some(r => r.payload.category === 'special')).toBe(true);

		// sessionId filter
		results = await backend.search([1, 2, 3], 10, { sessionId: 's1' });
		expect(results.some(r => r.payload.sessionId === 's1')).toBe(true);

		// traceId filter
		results = await backend.search([1, 2, 3], 10, { traceId: 't2' });
		expect(results.some(r => r.payload.traceId === 't2')).toBe(true);

		// timestamp gte
		results = await backend.search([1, 2, 3], 10, { timestamp: { gte: 400 } });
		expect(results.some(r => r.payload.timestamp >= 400)).toBe(true);
	});
	let backend: PgVectorBackend;
	const collectionName = 'test_collection';
	const dimension = 3;

	beforeAll(async () => {
		const config: any = {
			type: 'pgvector',
			url: 'postgres://localhost:5432/cipher_test',
			collectionName,
			dimension,
		};
		backend = new PgVectorBackend(config);
		await backend.connect();
	});

	afterAll(async () => {
		await backend.deleteCollection();
		await backend.disconnect();
	});

	afterEach(async () => {
		const client = await (backend as any).pool.connect();
		try {
			await client.query(`TRUNCATE TABLE ${collectionName}`);
		} finally {
			client.release();
		}
	});

	it('should connect and create a table', () => {
		expect(backend.isConnected()).toBe(true);
	});

	it('should insert and retrieve a vector', async () => {
		const vector = [1, 2, 3];
		const id = 1;
		const payload = { test: 'payload' };

		await backend.insert([vector], [id], [payload]);

		const result = await backend.get(id);
		expect(result).not.toBeNull();
		expect(result?.id).toBe(id);
		expect(result?.vector).toEqual(vector);
		expect(result?.payload).toEqual(payload);
	});

	it('should perform a similarity search', async () => {
		const vectors = [
			[1, 1, 1],
			[2, 2, 2],
			[3, 3, 3],
		];
		const ids = [1, 2, 3];
		const payloads = [{}, {}, {}];

		await backend.insert(vectors, ids, payloads);

		const queryVector = [1.1, 1.1, 1.1];
		const results = await backend.search(queryVector, 2);

		expect(results.length).toBe(2);
		expect(results[0].id).toBe(1);
	});

	it('should update a vector', async () => {
		const vector = [1, 2, 3];
		const id = 1;
		const payload = { test: 'payload' };

		await backend.insert([vector], [id], [payload]);

		const newVector = [4, 5, 6];
		const newPayload = { updated: true };
		await backend.update(id, newVector, newPayload);

		const result = await backend.get(id);
		expect(result?.vector).toEqual(newVector);
		expect(result?.payload).toEqual(newPayload);
	});

	it('should delete a vector', async () => {
		const vector = [1, 2, 3];
		const id = 1;
		const payload = {};

		await backend.insert([vector], [id], [payload]);
		await backend.delete(id);

		const result = await backend.get(id);
		expect(result).toBeNull();
	});

	it('should list vectors', async () => {
		const vectors = [
			[1, 1, 1],
			[2, 2, 2],
		];
		const ids = [1, 2];
		const payloads = [{}, {}];

		await backend.insert(vectors, ids, payloads);

		const [results, count] = await backend.list();
		expect(results.length).toBe(2);
		expect(count).toBe(2);
	});
});
