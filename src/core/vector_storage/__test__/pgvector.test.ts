import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PgVectorBackend } from '../backend/pgvector.js';
import { VectorStoreConnectionError, VectorDimensionError } from '../backend/types.js';

// Mock the pg library
const mockClient = {
	query: vi.fn(),
	release: vi.fn(),
};

const mockPool = {
	connect: vi.fn(() => Promise.resolve(mockClient)),
	end: vi.fn(),
	query: vi.fn(),
};

vi.mock('pg', () => ({
	Pool: vi.fn(() => mockPool),
	types: {
		setTypeParser: vi.fn(),
	},
}));

describe('PgVectorBackend', () => {
	let backend: PgVectorBackend;
	const collectionName = 'test_collection';
	const dimension = 3;

	beforeEach(() => {
		vi.clearAllMocks();
		backend = new PgVectorBackend({
			type: 'pgvector',
			collectionName,
			dimension,
			url: 'postgresql://test:test@localhost:5432/test',
		});
	});

	afterEach(async () => {
		if (backend.isConnected()) {
			await backend.disconnect();
		}
	});

	describe('Connection Management', () => {
		it('should connect and create table if it does not exist', async () => {
			mockClient.query
				.mockResolvedValueOnce({ rows: [] }) // SELECT oid FROM pg_type WHERE typname = 'vector'
				.mockResolvedValueOnce({ rows: [] }) // CREATE EXTENSION IF NOT EXISTS vector
				.mockResolvedValueOnce({ rows: [{ exists: false }] }); // Table does not exist
			await backend.connect();
			expect(backend.isConnected()).toBe(true);
			expect(mockPool.connect).toHaveBeenCalled();
			expect(mockClient.query).toHaveBeenCalledWith(
				"SELECT oid FROM pg_type WHERE typname = 'vector'"
			);
			expect(mockClient.query).toHaveBeenCalledWith('CREATE EXTENSION IF NOT EXISTS vector');
			expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
		});

		it('should connect without creating table if it exists', async () => {
			mockClient.query
				.mockResolvedValueOnce({ rows: [] }) // SELECT oid FROM pg_type WHERE typname = 'vector'
				.mockResolvedValueOnce({ rows: [] }) // CREATE EXTENSION IF NOT EXISTS vector
				.mockResolvedValueOnce({ rows: [{ exists: true }] }); // Table exists
			await backend.connect();
			expect(backend.isConnected()).toBe(true);
			expect(mockClient.query).toHaveBeenCalledWith(
				"SELECT oid FROM pg_type WHERE typname = 'vector'"
			);
			expect(mockClient.query).toHaveBeenCalledWith('CREATE EXTENSION IF NOT EXISTS vector');
			expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
		});

		it('should handle connection failure', async () => {
			mockPool.connect.mockRejectedValueOnce(new Error('Connection failed'));
			await expect(backend.connect()).rejects.toThrow(VectorStoreConnectionError);
		});
	});

	describe('Vector Operations', () => {
		beforeEach(async () => {
			mockClient.query.mockResolvedValue({ rows: [{ exists: true }] });
			await backend.connect();
			vi.clearAllMocks(); // Clear mocks after connection
		});

		it('should insert a vector', async () => {
			await backend.insert([[1, 2, 3]], [1], [{ data: 'test' }]);
			expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
			expect(mockClient.query).toHaveBeenCalledWith(
				`INSERT INTO ${collectionName} (id, vector, payload) VALUES ($1, $2, $3)`,
				[1, '[1,2,3]', { data: 'test' }]
			);
			expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
		});

		it('should get a vector', async () => {
			const vector = [1, 2, 3];
			const payload = { test: 'payload' };
			mockPool.query.mockResolvedValue({ rows: [{ id: 1, vector, payload }] });

			const result = await backend.get(1);
			expect(result).toEqual({ id: 1, vector, payload, score: 1.0 });
		});

		it('should search for vectors', async () => {
			mockClient.query.mockResolvedValue({ rows: [{ id: 1, score: 0.9, payload: {} }] });
			const results = await backend.search([1, 2, 3], 1);
			expect(results.length).toBe(1);
			expect(results[0].id).toBe(1);
		});

		it('should update a vector', async () => {
			await backend.update(1, [4, 5, 6], { updated: true });
			expect(mockPool.query).toHaveBeenCalledWith(
				`UPDATE ${collectionName} SET vector = $1, payload = $2 WHERE id = $3`,
				['[4,5,6]', { updated: true }, 1]
			);
		});

		it('should delete a vector', async () => {
			await backend.delete(1);
			expect(mockPool.query).toHaveBeenCalledWith(`DELETE FROM ${collectionName} WHERE id = $1`, [
				1,
			]);
		});

		it('should throw dimension error on insert', async () => {
			await expect(backend.insert([[1, 2]], [1], [{}])).rejects.toThrow(VectorDimensionError);
		});
	});
});
