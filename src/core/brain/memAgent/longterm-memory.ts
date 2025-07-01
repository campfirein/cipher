// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';
import { PromptManager } from '../systemPrompt/manager.js';
import { OpenAIService } from '../llm/services/openai.js';
// @ts-ignore
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
 * Represents a single programming memory entry.
 */
export interface ProgrammingMemoryEntry {
  rawInput: string;
  concepts: string[];
  timestamp: string;
}

/**
 * Represents a single chat interaction entry for vector storage.
 */
export interface ChatInteractionEntry {
  userPurpose: string;
  cursorResponse: string;
  userEmbedding: number[];
  responseEmbedding: number[];
  timestamp: string;
  sessionId?: string;
}

/**
 * Manages long-term programming memory storage and retrieval.
 */
export class LongTermProgrammingMemory {
  private memoryFilePath: string;

  constructor(memoryFilePath?: string) {
    // ESM-compatible __dirname replacement
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    this.memoryFilePath = memoryFilePath || path.resolve(__dirname, '../../../..', 'memAgent', 'programming_memory.json');
    this.ensureFile();
  }

  /**
   * Ensures the memory file and its parent directory exist.
   */
  private ensureFile() {
    const dir = path.dirname(this.memoryFilePath);
    // Ensure parent directory exists (cross-platform)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.memoryFilePath)) {
      fs.writeFileSync(this.memoryFilePath, '[]', 'utf-8');
    }
  }

  /**
   * Extracts programming concepts from user input (simple keyword/code extraction).
   */
  static extractConcepts(input: string): string[] {
    // Simple extraction: find code blocks and common programming keywords
    const codeRegex = /`{1,3}([\s\S]*?)`{1,3}/g;
    const keywordList = [
      'function', 'class', 'interface', 'type', 'const', 'let', 'var', 'import', 'export',
      'async', 'await', 'Promise', 'error', 'try', 'catch', 'API', 'TypeScript', 'JavaScript',
      'test', 'mock', 'coverage', 'lint', 'config', 'schema', 'object', 'array', 'string', 'number',
    ];
    const foundConcepts = new Set<string>();
    let match;
    while ((match = codeRegex.exec(input)) !== null) {
      if (match && match[1]) {
        foundConcepts.add(match[1].trim());
      }
    }
    for (const keyword of keywordList) {
      if (input.includes(keyword)) {
        foundConcepts.add(keyword);
      }
    }
    return Array.from(foundConcepts);
  }

  /**
   * Extracts programming concepts from user input using LLM (OpenAI) and a system prompt from PromptManager.
   * Returns a JSON array of programming concepts, or an empty array on error.
   */
  static async extractConceptsWithLLM(
    input: string,
    promptManager: PromptManager,
    openaiService: OpenAIService
  ): Promise<string[]> {
    const systemPrompt = promptManager.getInstruction();
    if (!systemPrompt) return [];
    try {
      // Compose the message for OpenAI: system prompt + user input
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ];
      // Direct OpenAI API call for a single completion (bypassing context/tools)
      // @ts-ignore: openaiService.openai is private, but we need direct access for this use case
      const response = await openaiService["openai"].chat.completions.create({
        model: openaiService["model"],
        messages,
        temperature: 0,
        max_tokens: 256,
      });
      const content = response.choices[0]?.message?.content?.trim();
      if (!content) return [];
      // Try to parse the response as a JSON array
      const jsonStart = content.indexOf('[');
      const jsonEnd = content.lastIndexOf(']');
      if (jsonStart === -1 || jsonEnd === -1) return [];
      const jsonString = content.substring(jsonStart, jsonEnd + 1);
      const concepts = JSON.parse(jsonString);
      if (Array.isArray(concepts) && concepts.every(x => typeof x === 'string')) {
        return concepts;
      }
      return [];
    } catch (err) {
      // Log error if logger is available
      // console.error('LLM extraction error:', err);
      return [];
    }
  }

  /**
   * Asynchronously saves a new programming memory entry using LLM-based concept extraction.
   */
  async saveEntryWithLLM(
    rawInput: string,
    promptManager: PromptManager,
    openaiService: OpenAIService
  ) {
    const concepts = await LongTermProgrammingMemory.extractConceptsWithLLM(
      rawInput,
      promptManager,
      openaiService
    );
    const entry: ProgrammingMemoryEntry = {
      rawInput,
      concepts,
      timestamp: new Date().toISOString(),
    };
    const entries = this.getAllEntries();
    entries.push(entry);
    fs.writeFileSync(this.memoryFilePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  /**
   * (Deprecated) Synchronously saves a new programming memory entry using regex-based extraction.
   */
  saveEntry(rawInput: string) {
    const concepts = LongTermProgrammingMemory.extractConcepts(rawInput);
    const entry: ProgrammingMemoryEntry = {
      rawInput,
      concepts,
      timestamp: new Date().toISOString(),
    };
    const entries = this.getAllEntries();
    entries.push(entry);
    fs.writeFileSync(this.memoryFilePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  /**
   * Retrieves all programming memory entries.
   */
  getAllEntries(): ProgrammingMemoryEntry[] {
    this.ensureFile();
    const data = fs.readFileSync(this.memoryFilePath, 'utf-8');
    try {
      return JSON.parse(data) as ProgrammingMemoryEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Searches entries by keyword or concept.
   */
  searchEntries(query: string): ProgrammingMemoryEntry[] {
    const entries = this.getAllEntries();
    return entries.filter(entry =>
      entry.rawInput.includes(query) ||
      entry.concepts.some(concept => concept.includes(query))
    );
  }

  /**
   * Save a chat interaction (user purpose and response) with their embeddings.
   * Embeddings are generated using OpenAIService.generateEmbedding.
   * Data is stored in memAgent/chat_memory.json (simulating vectordb storage).
   * Allows configuration of embedding model and storage path.
   * Retries on error and logs failures.
   */
  static async saveChatInteractionWithEmbeddings(
    userPurpose: string,
    cursorResponse: string,
    openaiApiKey: string,
    options?: { embeddingModel?: string; storagePath?: string; maxRetries?: number; sessionId?: string }
  ) {
    const embeddingModel = options?.embeddingModel || process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';
    const storagePath = options?.storagePath || process.env.CHAT_MEMORY_PATH || 'memAgent/chat_memory.json';
    const maxRetries = options?.maxRetries || parseInt(process.env.EMBEDDING_RETRY || '3', 10);
    let userEmbedding: number[] = [];
    let responseEmbedding: number[] = [];
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        userEmbedding = await OpenAIService.generateEmbedding(openaiApiKey, userPurpose);
        break;
      } catch (err) {
        attempt++;
        // eslint-disable-next-line no-console
        console.error(`User embedding generation failed (attempt ${attempt}):`, err);
        if (attempt >= maxRetries) throw err;
        await new Promise(res => setTimeout(res, 500 * attempt));
      }
    }
    attempt = 0;
    while (attempt < maxRetries) {
      try {
        responseEmbedding = await OpenAIService.generateEmbedding(openaiApiKey, cursorResponse);
        break;
      } catch (err) {
        attempt++;
        // eslint-disable-next-line no-console
        console.error(`Response embedding generation failed (attempt ${attempt}):`, err);
        if (attempt >= maxRetries) throw err;
        await new Promise(res => setTimeout(res, 500 * attempt));
      }
    }
    const entry: ChatInteractionEntry = {
      userPurpose,
      cursorResponse,
      userEmbedding,
      responseEmbedding,
      timestamp: new Date().toISOString(),
      sessionId: options?.sessionId,
    };
    let entries: ChatInteractionEntry[] = [];
    attempt = 0;
    while (attempt < maxRetries) {
      try {
        if (fs.existsSync(storagePath)) {
          try {
            entries = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
          } catch {
            entries = [];
          }
        }
        entries.push(entry);
        fs.writeFileSync(storagePath, JSON.stringify(entries, null, 2), 'utf-8');
        break;
      } catch (err) {
        attempt++;
        // eslint-disable-next-line no-console
        console.error(`File write failed (attempt ${attempt}):`, err);
        if (attempt >= maxRetries) throw err;
        await new Promise(res => setTimeout(res, 500 * attempt));
      }
    }
  }
} 