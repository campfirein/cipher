/* eslint-env vitest */
import { vi } from 'vitest';
import { GeminiService } from '../gemini.js';
import { MCPManager } from '../../../../mcp/manager.js';
import { UnifiedToolManager } from '../../../tools/unified-tool-manager.js';
import { ContextManager } from '../../messages/manager.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

describe('GeminiService', () => {
  const fakeApiKey = 'fake-api-key';
  const fakeModel = 'gemini-pro';
  let gemini: GoogleGenerativeAI;
  let mcpManager: MCPManager;
  let contextManager: ContextManager;
  let unifiedToolManager: UnifiedToolManager;

  beforeEach(() => {
    gemini = new GoogleGenerativeAI(fakeApiKey);
    mcpManager = { getAllTools: vi.fn().mockResolvedValue([]), executeTool: vi.fn() } as any;
    contextManager = { addUserMessage: vi.fn(), addAssistantMessage: vi.fn(), getFormattedMessage: vi.fn().mockResolvedValue([]), addToolResult: vi.fn() } as any;
    unifiedToolManager = { getToolsForProvider: vi.fn().mockResolvedValue([]), executeTool: vi.fn(), getAllTools: vi.fn().mockResolvedValue([]) } as any;
  });

  it('should instantiate without error', () => {
    const service = new GeminiService(gemini, fakeModel, mcpManager, contextManager, 3, unifiedToolManager);
    expect(service).toBeDefined();
  });

  it('should return config with provider and model', () => {
    const service = new GeminiService(gemini, fakeModel, mcpManager, contextManager, 3, unifiedToolManager);
    expect(service.getConfig()).toEqual({ provider: 'gemini', model: fakeModel });
  });

  // Add more tests for generate, directGenerate, error handling, etc.
});
