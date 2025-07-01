import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QdrantClientService } from '../qdrant-client.js';
import { ChatMemoryEntry } from '../memory-service.js';

class TestQdrantClientService extends QdrantClientService {
  constructor(mockClient: any, collection: string) {
    super({ url: '', collection });
    // @ts-ignore
    this.client = mockClient;
    // @ts-ignore
    this.collection = collection;
  }
}

describe('QdrantClientService', () => {
  let qdrantClient: QdrantClientService;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      getCollection: vi.fn(),
      createCollection: vi.fn(),
      upsert: vi.fn(),
      search: vi.fn(),
    };
    qdrantClient = new TestQdrantClientService(mockClient, 'test-collection');
  });

  it('should upsert chat interaction successfully', async () => {
    mockClient.getCollection.mockResolvedValue(undefined);
    mockClient.upsert.mockResolvedValue(undefined);
    const entry: ChatMemoryEntry = {
      userPurpose: 'hi',
      cursorResponse: 'hello',
      userEmbedding: [0.1, 0.2, 0.3],
      responseEmbedding: [0.4, 0.5, 0.6],
      timestamp: new Date().toISOString(),
      sessionId: 'test',
    };
    await qdrantClient.upsertChatInteraction(entry);
    expect(mockClient.upsert).toHaveBeenCalled();
  });

  it('should create collection if not exists', async () => {
    mockClient.getCollection.mockRejectedValue(new Error('not found'));
    mockClient.createCollection.mockResolvedValue(undefined);
    mockClient.upsert.mockResolvedValue(undefined);
    const entry: ChatMemoryEntry = {
      userPurpose: 'hi',
      cursorResponse: 'hello',
      userEmbedding: [0.1, 0.2, 0.3],
      responseEmbedding: [0.4, 0.5, 0.6],
      timestamp: new Date().toISOString(),
      sessionId: 'test',
    };
    await qdrantClient.upsertChatInteraction(entry);
    expect(mockClient.createCollection).toHaveBeenCalled();
    expect(mockClient.upsert).toHaveBeenCalled();
  });

  it('should search by embedding successfully', async () => {
    const payload = {
      userPurpose: 'hi',
      cursorResponse: 'hello',
      responseEmbedding: [0.4, 0.5, 0.6],
      timestamp: new Date().toISOString(),
      sessionId: 'test',
    };
    mockClient.search.mockResolvedValue([
      { payload },
    ]);
    const result = await qdrantClient.searchByEmbedding([0.1, 0.2, 0.3]);
    expect(result[0].userPurpose).toBe('hi');
    expect(result[0].cursorResponse).toBe('hello');
    expect(mockClient.search).toHaveBeenCalled();
  });

  it('should handle upsert errors', async () => {
    mockClient.getCollection.mockResolvedValue(undefined);
    mockClient.upsert.mockRejectedValue(new Error('upsert error'));
    const entry: ChatMemoryEntry = {
      userPurpose: 'fail',
      cursorResponse: 'fail',
      userEmbedding: [0.1, 0.2, 0.3],
      responseEmbedding: [0.4, 0.5, 0.6],
      timestamp: new Date().toISOString(),
      sessionId: 'fail',
    };
    await expect(qdrantClient.upsertChatInteraction(entry)).rejects.toThrow('upsert error');
  });

  it('should handle search errors', async () => {
    mockClient.search.mockRejectedValue(new Error('search error'));
    await expect(qdrantClient.searchByEmbedding([0.1, 0.2, 0.3])).rejects.toThrow('search error');
  });
}); 