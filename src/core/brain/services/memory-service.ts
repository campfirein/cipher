import { QdrantClientService } from './qdrant-client.js';
import fs from 'fs';
import path from 'path';

export interface ChatMemoryEntry {
  userPurpose: string;
  cursorResponse: string;
  userEmbedding: number[];
  responseEmbedding: number[];
  timestamp: string;
  sessionId?: string;
}

export type MemoryBackend = 'file' | 'qdrant';

export class MemoryService {
  private backend: MemoryBackend;
  private filePath: string;
  private qdrant?: QdrantClientService;

  constructor(options: { backend?: MemoryBackend; filePath?: string; qdrant?: QdrantClientService }) {
    this.backend = options.backend || 'file';
    this.filePath = options.filePath || path.resolve(process.cwd(), 'memAgent', 'chat_memory.json');
    this.qdrant = options.qdrant;
  }

  async saveChatInteraction(entry: ChatMemoryEntry) {
    if (this.backend === 'file') {
      let entries: ChatMemoryEntry[] = [];
      if (fs.existsSync(this.filePath)) {
        try {
          entries = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        } catch {
          entries = [];
        }
      }
      entries.push(entry);
      fs.writeFileSync(this.filePath, JSON.stringify(entries, null, 2), 'utf-8');
    } else if (this.backend === 'qdrant' && this.qdrant) {
      await this.qdrant.upsertChatInteraction(entry);
    } else {
      throw new Error('No valid memory backend configured');
    }
  }

  async searchByEmbedding(embedding: number[], topK = 5): Promise<ChatMemoryEntry[]> {
    if (this.backend === 'file') {
      // File backend does not support vector search; return all entries
      if (fs.existsSync(this.filePath)) {
        try {
          return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        } catch {
          return [];
        }
      }
      return [];
    } else if (this.backend === 'qdrant' && this.qdrant) {
      return await this.qdrant.searchByEmbedding(embedding, topK);
    } else {
      throw new Error('No valid memory backend configured');
    }
  }
} 