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

import type {StepTokenUsage} from '../../core/domain/agent-events/types.js'
import type {
  CompactionPart,
  PatchPart,
  ReasoningPart,
  RetryPart,
  SnapshotPart,
  StepFinishPart,
  StepStartPart,
  TextPart,
  ToolPart,
} from '../../core/interfaces/message-types.js'
import type {SessionEventBus} from '../events/event-emitter.js'

/**
 * Stream event types that the processor can handle.
 * Following OpenCode's pattern with reasoning-start/delta/end lifecycle.
 */
export type StreamEvent =
  | { callId: string; error: string; type: 'tool-call-error' }
  | { callId: string; input: Record<string, unknown>; type: 'tool-call-input' }
  | { callId: string; output: string; type: 'tool-call-complete' }
  | { callId: string; toolName: string; type: 'tool-call-start' }
  | { callId: string; type: 'tool-call-running' }
  | { cost: number; finishReason: 'max_tokens' | 'stop' | 'tool_calls'; stepIndex: number; tokens: StepTokenUsage; type: 'step-finish' }
  | { delta: string; id: string; providerMetadata?: Record<string, unknown>; type: 'reasoning-delta-v2' }
  | { delta: string; type: 'reasoning-delta' }
  | { delta: string; type: 'text-delta' }
  | { id: string; providerMetadata?: Record<string, unknown>; type: 'reasoning-end' }
  | { id: string; providerMetadata?: Record<string, unknown>; type: 'reasoning-start' }
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
  /** Task ID for event routing (required for chunk events to reach TUI) */
  taskId?: string
}

/**
 * Accumulated state during stream processing.
 */
export interface ProcessorState {
  /** Current step index */
  currentStepIndex: number
  /** Parts created during processing */
  parts: Array<CompactionPart | PatchPart | ReasoningPart | RetryPart | SnapshotPart | StepFinishPart | StepStartPart | TextPart | ToolPart>
  /** Accumulated reasoning content (for legacy reasoning-delta events) */
  reasoningContent: string
  /** Reasoning parts indexed by ID (for v2 reasoning events) */
  reasoningParts: Map<string, ReasoningPart>
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
      reasoningContent: '',
      reasoningParts: new Map(),
      textContent: '',
      toolParts: new Map(),
    }

    let receivedFinish = false

    for await (const event of stream) {
      if (event.type === 'finish') {
        receivedFinish = true
      }

      await this.handleEvent(event, state, context)
    }

    // Safety net: if the stream ended without a 'finish' event (e.g., OpenRouter
    // stream closed without setting finish_reason), finalize any pending text part
    // so the TUI receives isComplete: true and stops showing a loading spinner.
    if (!receivedFinish) {
      this.finalizeTextPart(state, context)
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
        taskId: context.taskId,
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
        // Legacy: Emit reasoning chunk for UI streaming (simple delta without ID tracking)
        state.reasoningContent += event.delta
        context.eventBus.emit('llmservice:chunk', {
          content: event.delta,
          taskId: context.taskId,
          type: 'reasoning',
        })
        break
      }

      case 'reasoning-delta-v2': {
        // V2: Emit reasoning chunk with ID tracking (following OpenCode pattern)
        const reasoningPart = state.reasoningParts.get(event.id)
        if (reasoningPart) {
          reasoningPart.text += event.delta
          if (event.providerMetadata) {
            reasoningPart.providerMetadata = event.providerMetadata
          }

          context.eventBus.emit('llmservice:chunk', {
            content: event.delta,
            taskId: context.taskId,
            type: 'reasoning',
          })
        }

        break
      }

      case 'reasoning-end': {
        // Finalize reasoning part with end timestamp
        const reasoningPart = state.reasoningParts.get(event.id)
        if (reasoningPart) {
          reasoningPart.text = reasoningPart.text.trimEnd()
          reasoningPart.time.end = Date.now()
          if (event.providerMetadata) {
            reasoningPart.providerMetadata = event.providerMetadata
          }

          // Emit completion signal
          context.eventBus.emit('llmservice:chunk', {
            content: '',
            isComplete: true,
            taskId: context.taskId,
            type: 'reasoning',
          })
        }

        break
      }

      case 'reasoning-start': {
        // Create new reasoning part and track it
        const reasoningPart: ReasoningPart = {
          id: event.id,
          providerMetadata: event.providerMetadata,
          text: '',
          time: {
            start: Date.now(),
          },
          type: 'reasoning',
        }
        state.reasoningParts.set(event.id, reasoningPart)
        state.parts.push(reasoningPart)
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
        this.handleToolCallInput(event.callId, event.input, state, context)
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
      taskId: context.taskId,
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
  private handleToolCallInput(callId: string, input: Record<string, unknown>, state: ProcessorState, context: ProcessorContext): void {
    const toolPart = state.toolParts.get(callId)
    if (toolPart && toolPart.state.status === 'pending') {
      toolPart.state = {
        input,
        status: 'pending',
      }

      // Emit updated tool call event with args so TUI can display them
      context.eventBus.emit('llmservice:toolCall', {
        args: input,
        callId,
        taskId: context.taskId,
        toolName: toolPart.toolName,
      })
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

    // Emit tool call event with taskId for TUI routing
    context.eventBus.emit('llmservice:toolCall', {
      args: {},
      callId,
      taskId: context.taskId,
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
