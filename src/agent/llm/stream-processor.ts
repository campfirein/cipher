/**
 * Stream Processor
 *
 * Handles granular LLM stream processing following the OpenCode pattern.
 * Provides real-time event emission for streaming text, tool calls, and step tracking.
 *
 * Key features:
 * - Delta-based text updates for responsive UI
 * - Tool call lifecycle tracking (pending → running → completed/error)
 * - Step-level cost and token tracking
 * - Part creation and updates with unique IDs
 */

import type {StepTokenUsage} from '../types/agent-events/types.js'
import type {
  CompactionPart,
  PatchPart,
  RetryPart,
  SnapshotPart,
  StepFinishPart,
  StepStartPart,
  TextPart,
  ToolPart,
} from '../interfaces/message-types.js'
import type {SessionEventBus} from '../events/event-emitter.js'

/**
 * Stream event types that the processor can handle.
 */
export type StreamEvent =
  | { callId: string; error: string; type: 'tool-call-error' }
  | { callId: string; input: Record<string, unknown>; type: 'tool-call-input' }
  | { callId: string; output: string; type: 'tool-call-complete' }
  | { callId: string; toolName: string; type: 'tool-call-start' }
  | { callId: string; type: 'tool-call-running' }
  | { cost: number; finishReason: 'max_tokens' | 'stop' | 'tool_calls'; stepIndex: number; tokens: StepTokenUsage; type: 'step-finish' }
  | { delta: string; type: 'reasoning-delta' }
  | { delta: string; type: 'text-delta' }
  | { stepIndex: number; type: 'step-start' }
  | { type: 'finish' }

/**
 * Context provided to the stream processor.
 */
export interface ProcessorContext {
  /** Event bus for emitting events */
  eventBus: SessionEventBus
  /** Function to generate unique IDs */
  generateId: () => string
  /** Session ID for event context */
  sessionId: string
}

/**
 * Accumulated state during stream processing.
 */
export interface ProcessorState {
  /** Current step index */
  currentStepIndex: number
  /** Parts created during processing */
  parts: Array<CompactionPart | PatchPart | RetryPart | SnapshotPart | StepFinishPart | StepStartPart | TextPart | ToolPart>
  /** Accumulated text content */
  textContent: string
  /** Tool parts indexed by call ID */
  toolParts: Map<string, ToolPart>
}

/**
 * Stream Processor class.
 *
 * Processes streaming events from LLM providers and emits granular events
 * for real-time UI updates. Follows the OpenCode pattern of part-based
 * message construction with delta updates.
 *
 * @example
 * ```typescript
 * const processor = new StreamProcessor()
 *
 * const state = await processor.process(streamEvents, {
 *   eventBus: sessionEventBus,
 *   generateId: () => crypto.randomUUID(),
 *   sessionId: 'session-123',
 * })
 *
 * console.log('Accumulated text:', state.textContent)
 * console.log('Parts created:', state.parts.length)
 * ```
 */
export class StreamProcessor {
  /**
   * Process a stream of events and emit granular updates.
   *
   * @param stream - Async iterable of stream events
   * @param context - Processing context with event bus and utilities
   * @returns Final processor state with accumulated parts
   */
  public async process(stream: AsyncIterable<StreamEvent>, context: ProcessorContext): Promise<ProcessorState> {
    const state: ProcessorState = {
      currentStepIndex: 0,
      parts: [],
      textContent: '',
      toolParts: new Map(),
    }

    for await (const event of stream) {
      await this.handleEvent(event, state, context)
    }

    return state
  }

  /**
   * Finalize text part if there's accumulated content.
   */
  private finalizeTextPart(state: ProcessorState, context: ProcessorContext): void {
    if (state.textContent.length > 0) {
      const textPart: TextPart = {
        text: state.textContent,
        type: 'text',
      }
      state.parts.push(textPart)

      // Emit final chunk
      context.eventBus.emit('llmservice:chunk', {
        content: '',
        isComplete: true,
        type: 'text',
      })
    }
  }

  /**
   * Handle a single stream event.
   */
  private async handleEvent(event: StreamEvent, state: ProcessorState, context: ProcessorContext): Promise<void> {
    switch (event.type) {
      case 'finish': {
        // Finalize any pending text part
        this.finalizeTextPart(state, context)
        break
      }

      case 'reasoning-delta': {
        // Emit reasoning chunk for UI streaming
        context.eventBus.emit('llmservice:chunk', {
          content: event.delta,
          type: 'reasoning',
        })
        break
      }

      case 'step-finish': {
        this.handleStepFinish(
          {
            cost: event.cost,
            finishReason: event.finishReason,
            stepIndex: event.stepIndex,
            tokens: event.tokens,
          },
          state,
          context,
        )
        break
      }

      case 'step-start': {
        this.handleStepStart(event.stepIndex, state, context)
        break
      }

      case 'text-delta': {
        this.handleTextDelta(event.delta, state, context)
        break
      }

      case 'tool-call-complete': {
        this.handleToolCallComplete(event.callId, event.output, state)
        break
      }

      case 'tool-call-error': {
        this.handleToolCallError(event.callId, event.error, state)
        break
      }

      case 'tool-call-input': {
        this.handleToolCallInput(event.callId, event.input, state)
        break
      }

      case 'tool-call-running': {
        this.handleToolCallRunning(event.callId, state)
        break
      }

      case 'tool-call-start': {
        this.handleToolCallStart(event.callId, event.toolName, state, context)
        break
      }
    }
  }

  /**
   * Handle step finish event.
   */
  private handleStepFinish(
    options: {
      cost: number
      finishReason: 'max_tokens' | 'stop' | 'tool_calls'
      stepIndex: number
      tokens: StepTokenUsage
    },
    state: ProcessorState,
    context: ProcessorContext,
  ): void {
    const stepFinishPart: StepFinishPart = {
      cost: options.cost,
      finishReason: options.finishReason,
      id: context.generateId(),
      stepIndex: options.stepIndex,
      timestamp: Date.now(),
      tokens: options.tokens,
      type: 'step_finish',
    }
    state.parts.push(stepFinishPart)

    // Emit step finished event
    context.eventBus.emit('step:finished', {
      cost: options.cost,
      finishReason: options.finishReason,
      stepIndex: options.stepIndex,
      tokens: options.tokens,
    })
  }

  /**
   * Handle step start event.
   */
  private handleStepStart(stepIndex: number, state: ProcessorState, context: ProcessorContext): void {
    state.currentStepIndex = stepIndex

    const stepStartPart: StepStartPart = {
      id: context.generateId(),
      stepIndex,
      timestamp: Date.now(),
      type: 'step_start',
    }
    state.parts.push(stepStartPart)

    // Emit step started event
    context.eventBus.emit('step:started', {
      stepIndex,
    })
  }

  /**
   * Handle text delta - accumulate and emit.
   */
  private handleTextDelta(delta: string, state: ProcessorState, context: ProcessorContext): void {
    state.textContent += delta

    // Emit chunk with delta for real-time UI update
    context.eventBus.emit('llmservice:chunk', {
      content: delta,
      type: 'text',
    })
  }

  /**
   * Handle tool call completion.
   */
  private handleToolCallComplete(callId: string, output: string, state: ProcessorState): void {
    const toolPart = state.toolParts.get(callId)
    if (toolPart && toolPart.state.status === 'running') {
      const startTime = toolPart.state.startedAt
      toolPart.state = {
        input: toolPart.state.input,
        output,
        status: 'completed',
        time: {
          end: Date.now(),
          start: startTime,
        },
      }
    }
  }

  /**
   * Handle tool call error.
   */
  private handleToolCallError(callId: string, error: string, state: ProcessorState): void {
    const toolPart = state.toolParts.get(callId)
    if (toolPart) {
      const startTime = toolPart.state.status === 'running' ? toolPart.state.startedAt : Date.now()
      toolPart.state = {
        error,
        input: toolPart.state.input,
        status: 'error',
        time: {
          end: Date.now(),
          start: startTime,
        },
      }
    }
  }

  /**
   * Handle tool call input received.
   */
  private handleToolCallInput(callId: string, input: Record<string, unknown>, state: ProcessorState): void {
    const toolPart = state.toolParts.get(callId)
    if (toolPart && toolPart.state.status === 'pending') {
      toolPart.state = {
        input,
        status: 'pending',
      }
    }
  }

  /**
   * Handle tool call transition to running.
   */
  private handleToolCallRunning(callId: string, state: ProcessorState): void {
    const toolPart = state.toolParts.get(callId)
    if (toolPart && toolPart.state.status === 'pending') {
      toolPart.state = {
        input: toolPart.state.input,
        startedAt: Date.now(),
        status: 'running',
      }
    }
  }

  /**
   * Handle tool call start - create pending tool part.
   */
  private handleToolCallStart(callId: string, toolName: string, state: ProcessorState, context: ProcessorContext): void {
    // Finalize any pending text before tool call
    this.finalizeTextPart(state, context)
    state.textContent = ''

    const toolPart: ToolPart = {
      callId,
      state: {
        input: {},
        status: 'pending',
      },
      toolName,
      type: 'tool',
    }

    state.toolParts.set(callId, toolPart)
    state.parts.push(toolPart)

    // Emit tool call event
    context.eventBus.emit('llmservice:toolCall', {
      args: {},
      callId,
      toolName,
    })
  }
}

/**
 * Helper to create a unique ID generator.
 */
export function createIdGenerator(): () => string {
  let counter = 0
  return () => `part-${Date.now()}-${++counter}`
}

/**
 * Singleton stream processor instance.
 */
export const streamProcessor = new StreamProcessor()
