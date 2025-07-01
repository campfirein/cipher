import 'dotenv/config';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemAgent } from '../agent.js';
import { AgentConfig } from '../config.js';
import { MemoryService, ChatMemoryEntry } from '../../services/memory-service.js';
import * as relevanceUtils from '../utils/isProgrammingRelatedLLM.js';

describe('MemAgent Integration', () => {
  let memAgent: MemAgent;
  let mockMemoryService: MemoryService;
  let config: AgentConfig;
  let originalGenerateEmbedding;

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key'; // fallback for CI
    config = {
      mcpServers: {},
      llm: { provider: 'openai', model: 'gpt-3.5-turbo', apiKey: process.env.OPENAI_API_KEY },
      session: { maxSessions: 10, ttl: 10000 },
    } as any;
    memAgent = new MemAgent(config);
    await memAgent.start();
    mockMemoryService = memAgent['memoryService'];
    console.log('Before spy, memoryService:', mockMemoryService);
    vi.spyOn(mockMemoryService, 'saveChatInteraction').mockImplementation((entry) => {
      console.log('saveChatInteraction called with:', entry);
      return Promise.resolve();
    });
    console.log('After spy, memoryService:', memAgent['memoryService']);
    // Mock OpenAIService methods (instance)
    memAgent['openaiService'] = {
      generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      generateChatCompletion: vi.fn().mockResolvedValue('This is a test AI response'),
      openai: { apiKey: process.env.OPENAI_API_KEY },
    } as any;
    // Patch sessionManager methods to return a mock session
    const mockSession = {
      id: 'test-session',
      addMessage: vi.fn(),
      getMessages: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
      run: vi.fn().mockResolvedValue('This is a test AI response'),
    } as any;
    vi.spyOn(memAgent['sessionManager'], 'getSession').mockReturnValue(mockSession);
    vi.spyOn(memAgent['sessionManager'], 'createSession').mockReturnValue(mockSession);
    // Mock static OpenAIService.generateEmbedding
    const openaiModule = await import('../../llm/services/openai.js');
    originalGenerateEmbedding = openaiModule.OpenAIService.generateEmbedding;
    openaiModule.OpenAIService.generateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
  });

  afterEach(async () => {
    // Restore static method
    const openaiModule = await import('../../llm/services/openai.js');
    openaiModule.OpenAIService.generateEmbedding = originalGenerateEmbedding;
    vi.restoreAllMocks();
  });

  it('should save chat interaction on run', async () => {
    const userInput = 'What is Qdrant?';
    await memAgent.run(userInput, undefined, 'test-session');
    await vi.waitFor(() => {
      expect(mockMemoryService.saveChatInteraction).toHaveBeenCalled();
    }, { timeout: 2000 });
    const entry = (mockMemoryService.saveChatInteraction as any).mock.calls[0][0] as ChatMemoryEntry;
    expect(entry.userPurpose).toBe(userInput);
    expect(entry.cursorResponse).toBe('This is a test AI response');
    expect(entry.userEmbedding).toEqual([0.1, 0.2, 0.3]);
    expect(entry.responseEmbedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('should not save chat interaction if no response', async () => {
    const mockSession: any = {
      id: 'test-session',
      run: vi.fn().mockResolvedValue(''),
      contextManager: {},
      llmService: {},
      services: {},
      init: vi.fn(),
      getHistory: vi.fn(),
      addMessage: vi.fn(),
      clear: vi.fn(),
      getLastUserMessage: vi.fn(),
      getLastAIMessage: vi.fn(),
    };
    vi.spyOn(memAgent.sessionManager, 'getSession').mockImplementation(async () => mockSession);
    vi.spyOn(memAgent.sessionManager, 'createSession').mockImplementation(async () => mockSession);
    const userInput = 'Empty response test';
    await memAgent.run(userInput, undefined, 'test-session');
    expect(mockMemoryService.saveChatInteraction).not.toHaveBeenCalled();
  });

  it('should save chat interaction if programming-related (LLM check)', async () => {
    // Mock LLM relevance check to return true
    vi.spyOn(relevanceUtils, 'isProgrammingRelatedLLM').mockResolvedValue(true);
    const userInput = 'How do I write a Python function?';
    await memAgent.run(userInput, undefined, 'test-session');
    await vi.waitFor(() => {
      expect(mockMemoryService.saveChatInteraction).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it('should NOT save chat interaction if not programming-related (LLM check)', async () => {
    // Mock LLM relevance check to return false
    vi.spyOn(relevanceUtils, 'isProgrammingRelatedLLM').mockResolvedValue(false);
    const userInput = 'What is the weather today?';
    await memAgent.run(userInput, undefined, 'test-session');
    // Wait a bit to ensure async logic completes
    await new Promise(res => setTimeout(res, 500));
    expect(mockMemoryService.saveChatInteraction).not.toHaveBeenCalled();
  });

  it('should NOT save chat interaction if LLM throws error', async () => {
    // Mock LLM relevance check to throw
    vi.spyOn(relevanceUtils, 'isProgrammingRelatedLLM').mockRejectedValue(new Error('LLM error'));
    const userInput = 'Is this programming related?';
    await memAgent.run(userInput, undefined, 'test-session');
    await new Promise(res => setTimeout(res, 500));
    expect(mockMemoryService.saveChatInteraction).not.toHaveBeenCalled();
  });

  it('should NOT save chat interaction if LLM returns unexpected value', async () => {
    // Mock LLM relevance check to return undefined (simulate unexpected)
    vi.spyOn(relevanceUtils, 'isProgrammingRelatedLLM').mockResolvedValue(undefined as any);
    const userInput = 'Ambiguous message';
    await memAgent.run(userInput, undefined, 'test-session');
    await new Promise(res => setTimeout(res, 500));
    expect(mockMemoryService.saveChatInteraction).not.toHaveBeenCalled();
  });
}); 