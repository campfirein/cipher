import { QdrantClient } from '@qdrant/js-client-rest';
import { ChatMemoryEntry } from './memory-service.js';

/**
 * QdrantClientService abstracts vector storage and search using Qdrant (local or cloud).
 *
 * - Reads QDRANT_URL and QDRANT_API_KEY from environment variables (if used via MemAgent).
 * - If QDRANT_API_KEY is set, it is sent as the 'api-key' header for Qdrant Cloud authentication.
 * - Supports both HTTP (local) and HTTPS (cloud) endpoints.
 * - Do NOT commit your Qdrant Cloud API key to version control.
 */
export class QdrantClientService {
  private client: QdrantClient;
  private collection: string;

  /**
   * @param options.url Qdrant endpoint URL (e.g., http://localhost:6333 or https://<cluster-id>.qdrant.cloud)
   * @param options.apiKey Qdrant Cloud API key (optional, required for cloud)
   * @param options.collection Collection name to use
   */
  constructor(options: { url: string; apiKey?: string; collection: string }) {
    this.client = new QdrantClient({
      url: options.url,
      apiKey: options.apiKey,
    });
    this.collection = options.collection;
  }

  async upsertChatInteraction(entry: ChatMemoryEntry): Promise<void> {
    const point = {
      id: Date.now() + Math.floor(Math.random() * 10000),
      vector: entry.userEmbedding,
      payload: {
        userPurpose: entry.userPurpose,
        cursorResponse: entry.cursorResponse,
        responseEmbedding: entry.responseEmbedding,
        timestamp: entry.timestamp,
        sessionId: entry.sessionId,
      },
    };
    // Ensure collection exists (create if not)
    try {
      await this.client.getCollection(this.collection);
    } catch {
      await this.client.createCollection(this.collection, {
        vectors: {
          size: entry.userEmbedding.length,
          distance: 'Cosine',
        },
      });
    }
    await this.client.upsert(this.collection, { points: [point] });
  }

  async searchByEmbedding(embedding: number[], topK = 5): Promise<ChatMemoryEntry[]> {
    const result = await this.client.search(this.collection, {
      vector: embedding,
      limit: topK,
      with_payload: true,
    });
    return result.map(({ payload }) => ({
      userPurpose: String(payload?.userPurpose ?? ''),
      cursorResponse: String(payload?.cursorResponse ?? ''),
      userEmbedding: embedding,
      responseEmbedding: (payload?.responseEmbedding ?? []) as number[],
      timestamp: String(payload?.timestamp ?? ''),
      sessionId: payload?.sessionId ? String(payload.sessionId) : undefined,
    }));
  }

  /**
   * Helper to create a QdrantClientService from environment variables.
   * @returns QdrantClientService
   */
  static fromEnv(): QdrantClientService {
    const url = process.env.QDRANT_URL || 'http://localhost:6333';
    const apiKey = process.env.QDRANT_API_KEY;
    const collection = process.env.QDRANT_COLLECTION || 'chat_memory';
    return new QdrantClientService({ url, apiKey, collection });
  }
} 