export const LlmEvents = {
  CHUNK: 'llmservice:chunk',
  ERROR: 'llmservice:error',
  OUTPUT_TRUNCATED: 'llmservice:outputTruncated',
  RESPONSE: 'llmservice:response',
  THINKING: 'llmservice:thinking',
  THOUGHT: 'llmservice:thought',
  TODO_UPDATED: 'llmservice:todoUpdated',
  TOOL_CALL: 'llmservice:toolCall',
  TOOL_RESULT: 'llmservice:toolResult',
  UNSUPPORTED_INPUT: 'llmservice:unsupportedInput',
  WARNING: 'llmservice:warning',
} as const
