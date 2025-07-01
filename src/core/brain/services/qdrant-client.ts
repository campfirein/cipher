import { QdrantClient } from '@qdrant/js-client-rest';
import { ChatMemoryEntry } from './memory-service.js';

export class QdrantClientService {
  private client: QdrantClient;
  private collection: string;

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
} 