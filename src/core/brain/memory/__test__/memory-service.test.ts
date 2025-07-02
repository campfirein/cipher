import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryService, ChatMemoryEntry } from '../memory-service.js';
import { QdrantClientService } from '../qdrant-client.js';

describe('MemoryService', () => {
  let memoryService: MemoryService;
  let mockQdrant;

  beforeEach(() => {
    mockQdrant = {
      upsertChatInteraction: vi.fn(),
      searchByEmbedding: vi.fn(),
    };
    memoryService = new MemoryService({ backend: 'qdrant', qdrant: mockQdrant });
  });

  it('should save chat interaction successfully', async () => {
    mockQdrant.upsertChatInteraction.mockResolvedValue(undefined);
    const entry: ChatMemoryEntry = {
      userPurpose: 'hello',
      cursorResponse: 'hi',
      userEmbedding: [0.1, 0.2, 0.3],
      responseEmbedding: [0.4, 0.5, 0.6],
      timestamp: new Date().toISOString(),
      sessionId: 'test-session',
    };
    await memoryService.saveChatInteraction(entry);
    expect(mockQdrant.upsertChatInteraction).toHaveBeenCalledWith(entry);
  });

  it('should search memory successfully', async () => {
    const mockResults: ChatMemoryEntry[] = [
      {
        userPurpose: 'hello',
        cursorResponse: 'hi',
        userEmbedding: [0.1, 0.2, 0.3],
        responseEmbedding: [0.4, 0.5, 0.6],
        timestamp: new Date().toISOString(),
        sessionId: 'test-session',
      },
    ];
    mockQdrant.searchByEmbedding.mockResolvedValue(mockResults);
    const result = await memoryService.searchByEmbedding([0.1, 0.2, 0.3]);
    expect(result).toEqual(mockResults);
    expect(mockQdrant.searchByEmbedding).toHaveBeenCalled();
  });

  it('should handle save errors', async () => {
    mockQdrant.upsertChatInteraction.mockRejectedValue(new Error('upsert failed'));
    const entry: ChatMemoryEntry = {
      userPurpose: 'fail',
      cursorResponse: 'fail',
      userEmbedding: [0.1, 0.2, 0.3],
      responseEmbedding: [0.4, 0.5, 0.6],
      timestamp: new Date().toISOString(),
      sessionId: 'test-session',
    };
    await expect(memoryService.saveChatInteraction(entry)).rejects.toThrow('upsert failed');
  });

  it('should handle search errors', async () => {
    mockQdrant.searchByEmbedding.mockRejectedValue(new Error('search failed'));
    await expect(memoryService.searchByEmbedding([0.1, 0.2, 0.3])).rejects.toThrow('search failed');
  });

  it('should construct with QdrantClientService.fromEnv (cloud)', () => {
    process.env.QDRANT_URL = 'https://test-cluster.qdrant.cloud';
    process.env.QDRANT_API_KEY = 'test-api-key';
    process.env.QDRANT_COLLECTION = 'test-collection';
    const qdrant = QdrantClientService.fromEnv();
    const memoryService = new MemoryService({ backend: 'qdrant', qdrant });
    expect(memoryService).toBeInstanceOf(MemoryService);
  });
}); 