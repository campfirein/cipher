import { IMessageFormatter } from './types';
import { ToolCall, ToolResponse } from '../../../mcp/types';

export class GeminiMessageFormatter implements IMessageFormatter {
  formatUserMessage(content: string, toolCalls?: ToolCall[]): any {
    // Gemini expects a 'parts' array for content, and tool calls as a separate field if present
    const message: any = {
      role: 'user',
      parts: [{ text: content }],
    };
    if (toolCalls && toolCalls.length > 0) {
      message.toolCalls = toolCalls.map(tc => ({
        functionName: tc.function.name,
        args: tc.function.arguments,
        id: tc.id,
      }));
    }
    return message;
  }

  formatAssistantMessage(content: string, toolResponses?: ToolResponse[]): any {
    // Gemini expects a 'parts' array for content, and tool responses as a separate field if present
    const message: any = {
      role: 'assistant',
      parts: [{ text: content }],
    };
    if (toolResponses && toolResponses.length > 0) {
      message.toolResponses = toolResponses.map(tr => ({
        functionName: tr.function.name,
        result: tr.result,
        id: tr.id,
      }));
    }
    return message;
  }
}
