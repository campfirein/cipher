import type {InternalMessage} from '../../../interfaces/cipher/message-types.js'

/**
 * Represents a coherent task episode in a conversation
 */
export interface Episode {
  /** Duration in milliseconds */
  durationMs: number

  /** When the episode ended (ISO timestamp) */
  endTime: string

  /** Unique identifier for the episode */
  id: string

  /** Number of messages in this episode */
  messageCount: number

  /** Messages that belong to this episode */
  messages: InternalMessage[]

  /** Metadata about the episode */
  metadata: EpisodeMetadata

  /** When the episode started (ISO timestamp) */
  startTime: string

  /** Brief description of what was accomplished in this episode */
  summary: string

  /** Human-readable title summarizing the episode */
  title: string
}

/**
 * Metadata about an episode
 */
export interface EpisodeMetadata {
  /** Additional custom metadata */
  [key: string]: unknown

  /** What triggered the episode boundary (time_gap, explicit_reset, context_switch) */
  boundaryTrigger?: 'context_switch' | 'explicit_reset' | 'session_start' | 'time_gap'

  /** Specific context switches detected (e.g., branch_change, file_change, command_change) */
  contextSwitches?: ContextSwitch[]

  /** Reset pattern that was matched (if boundaryTrigger is explicit_reset) */
  resetPattern?: string

  /** Tags or labels for categorizing the episode */
  tags?: string[]

  /** Time gap in minutes (if boundaryTrigger is time_gap) */
  timeGapMinutes?: number
}

/**
 * Represents a detected context switch
 */
export interface ContextSwitch {
  /** Description of the switch */
  description: string

  /** Message index where the switch occurred */
  messageIndex?: number

  /** New context value (e.g., new branch name) */
  newValue?: string

  /** Previous context value (e.g., previous branch name) */
  previousValue?: string

  /** Type of context switch */
  type: 'branch_change' | 'command_change' | 'file_change' | 'other'
}

/**
 * Criteria for segmenting conversations into episodes
 */
export interface SegmentationCriteria {
  /** Whether to detect and use context switches as boundaries (default: true) */
  detectContextSwitches?: boolean

  /** Maximum messages per episode before forcing a split (optional) */
  maxMessagesPerEpisode?: number

  /** Minimum messages per episode (default: 1) */
  minMessagesPerEpisode?: number

  /** Custom regex patterns for detecting explicit resets */
  resetPatterns?: string[]

  /** Maximum time gap in minutes before creating a new episode (default: 30) */
  timeGapMinutes?: number
}

/**
 * Default segmentation criteria values
 */
export const DEFAULT_SEGMENTATION_CRITERIA: Required<
  Omit<SegmentationCriteria, 'maxMessagesPerEpisode'>
> = {
  detectContextSwitches: true,
  minMessagesPerEpisode: 1,
  resetPatterns: [
    'new task',
    'different feature',
    'switch to',
    "let's work on",
    'moving on to',
    'next task',
    'start working on',
  ],
  timeGapMinutes: 30,
}

/**
 * Hierarchical context tree node
 */
export interface ContextTreeNode {
  /** Child episodes (sub-tasks) */
  children: ContextTreeNode[]

  /** Depth in the tree (0 for root) */
  depth: number

  /** The episode at this node */
  episode: Episode

  /** Parent node (undefined for root) */
  parent?: ContextTreeNode
}

/**
 * Result from conversation segmentation
 */
export interface SegmentationResult {
  /** Hierarchical context tree */
  contextTree: ContextTreeNode[]

  /** Criteria used for segmentation */
  criteria: SegmentationCriteria

  /** Flat list of all episodes */
  episodes: Episode[]

  /** Timestamp when segmentation was performed */
  segmentedAt: string

  /** Total conversation duration in milliseconds */
  totalDurationMs: number

  /** Total number of episodes */
  totalEpisodes: number
}

/**
 * Input for segment conversation tool.
 * Represents a simplified episode structure for tool input.
 */
export interface SegmentConversationInput {
  /** Array of episodes to process */
  episodes: EpisodeInput[]
}

/**
 * Episode input structure for segment conversation tool.
 * Simplified version of Episode for tool input.
 */
export interface EpisodeInput {
  /** Unique identifier for the episode */
  id: string

  /** Brief description of what was accomplished in this episode */
  summary: string

  /** Human-readable title summarizing the episode */
  title: string
}

/**
 * Output from segment conversation tool.
 */
export interface SegmentConversationOutput {
  /** Array of episodes */
  episodes: EpisodeInput[]

  /** Total number of episodes */
  totalEpisodes: number
}
