// @vitest-environment node
/// <reference types="vitest" />
// @ts-ignore
import fs from 'fs';
// @ts-ignore
import path from 'path';
import { LongTermProgrammingMemory, ProgrammingMemoryEntry, ChatInteractionEntry } from '../longterm-memory.js';

// Note: Test runner (e.g., Vitest) provides describe/it/expect globals

describe('LongTermProgrammingMemory', () => {
  // ESM-compatible __dirname replacement
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const testFilePath = path.resolve(__dirname, '../../../../memAgent/programming_memory_test.json');
  const chatMemoryPath = path.resolve(__dirname, '../../../../memAgent/chat_memory_test.json');
  let memory: LongTermProgrammingMemory;

  beforeEach(() => {
    // Ensure a clean test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    memory = new LongTermProgrammingMemory(testFilePath);
  });

  afterAll(() => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    if (fs.existsSync(chatMemoryPath)) {
      fs.unlinkSync(chatMemoryPath);
    }
  });

  it('should extract programming concepts from input', () => {
    const input = 'Here is a function: `function add(a, b) { return a + b; }` and some TypeScript.';
    const concepts = LongTermProgrammingMemory.extractConcepts(input);
    expect(concepts).toContain('function add(a, b) { return a + b; }');
    expect(concepts).toContain('function');
    expect(concepts).toContain('TypeScript');
  });

  it('should save and retrieve entries', () => {
    const input = 'Define a class in JavaScript.';
    memory.saveEntry(input);
    const entries = memory.getAllEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]!.rawInput).toBe(input);
    expect(entries[0]!.concepts).toContain('class');
    expect(entries[0]!.concepts).toContain('JavaScript');
  });

  it('should search entries by keyword or concept', () => {
    memory.saveEntry('How to use async/await in TypeScript?');
    memory.saveEntry('What is a Promise?');
    memory.saveEntry('Explain error handling.');
    const results = memory.searchEntries('Promise');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.concepts).toContain('Promise');
  });

  it('should save a chat interaction with embeddings', async () => {
    // Mock OpenAIService.generateEmbedding
    const mockEmbedding = [0.1, 0.2, 0.3];
    const originalGenerateEmbedding = require('../longterm-memory.js').OpenAIService.generateEmbedding;
    require('../longterm-memory.js').OpenAIService.generateEmbedding = async () => mockEmbedding;

    const userPurpose = 'Write a binary search tree.';
    const cursorResponse = 'Here is a binary search tree implementation...';
    await LongTermProgrammingMemory.saveChatInteractionWithEmbeddings(userPurpose, cursorResponse, 'fake-api-key');

    // Read the file and check contents
    const entries: ChatInteractionEntry[] = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'memAgent', 'chat_memory.json'), 'utf-8'));
    const lastEntry = entries[entries.length - 1];
    expect(lastEntry.userPurpose).toBe(userPurpose);
    expect(lastEntry.cursorResponse).toBe(cursorResponse);
    expect(lastEntry.userEmbedding).toEqual(mockEmbedding);
    expect(lastEntry.responseEmbedding).toEqual(mockEmbedding);
    expect(typeof lastEntry.timestamp).toBe('string');

    // Restore original
    require('../longterm-memory.js').OpenAIService.generateEmbedding = originalGenerateEmbedding;
  });
}); 