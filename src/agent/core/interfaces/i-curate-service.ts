/**
 * Curate service interface for sandbox integration.
 * Provides curate operations accessible via tools.curate() in the sandbox.
 */

/**
 * Raw concept metadata for a knowledge topic.
 */
export interface CurateRawConcept {
  /** What changes in the codebase are induced by this concept */
  changes?: string[]
  /** Which files are related to this concept */
  files?: string[]
  /** What is the flow included in this concept */
  flow?: string
  /** What is the task related to this concept */
  task?: string
  /** When the concept was created or modified (ISO 8601 format) */
  timestamp?: string
}

/**
 * Narrative section for descriptive and structural context.
 */
export interface CurateNarrative {
  /** Dependency management information */
  dependencies?: string
  /** Feature documentation for this concept */
  features?: string
  /** Code structure documentation */
  structure?: string
}

/**
 * Content structure for ADD and UPDATE operations.
 */
export interface CurateContent {
  /** Narrative section with descriptive and structural context */
  narrative?: CurateNarrative
  /** Raw concept section with metadata and technical footprint */
  rawConcept?: CurateRawConcept
  /** Related topics using domain/topic/title.md notation */
  relations?: string[]
  /** Code/text snippets */
  snippets?: string[]
}

/**
 * Domain context for domain-level context.md files.
 */
export interface CurateDomainContext {
  /** Which system, team, or layer owns this domain */
  ownership?: string
  /** Describe what this domain represents and why it exists */
  purpose: string
  /** Define what belongs and does not belong in this domain */
  scope: {
    /** What does NOT belong in this domain */
    excluded?: string[]
    /** What belongs in this domain */
    included: string[]
  }
  /** How this domain should be used by agents and contributors */
  usage?: string
}

/**
 * Topic context for topic-level context.md files.
 */
export interface CurateTopicContext {
  /** Key concepts covered in this topic */
  keyConcepts?: string[]
  /** Describe what this topic covers and its main focus */
  overview: string
  /** Related topics and how they connect */
  relatedTopics?: string[]
}

/**
 * Subtopic context for subtopic-level context.md files.
 */
export interface CurateSubtopicContext {
  /** Describe the specific focus of this subtopic */
  focus: string
  /** How this subtopic relates to its parent topic */
  parentRelation?: string
}

/**
 * Operation types for curating knowledge topics.
 */
export type CurateOperationType = 'ADD' | 'DELETE' | 'MERGE' | 'UPDATE' | 'UPSERT'

/**
 * Single curate operation.
 */
export interface CurateOperation {
  /** Content for ADD/UPDATE operations */
  content?: CurateContent
  /** Domain-level context for new domains */
  domainContext?: CurateDomainContext
  /** Target path for MERGE operation */
  mergeTarget?: string
  /** Title of the target file for MERGE operation */
  mergeTargetTitle?: string
  /** Path: domain/topic or domain/topic/subtopic */
  path: string
  /** Reasoning for this operation */
  reason: string
  /** Subtopic-level context for new subtopics */
  subtopicContext?: CurateSubtopicContext
  /** Title for the context file (becomes {title}.md) */
  title?: string
  /** Topic-level context for new topics */
  topicContext?: CurateTopicContext
  /** Operation type: ADD, UPDATE, MERGE, or DELETE */
  type: CurateOperationType
}

/**
 * Result of a single curate operation.
 */
export interface CurateOperationResult {
  /** Full filesystem path to the created/modified file */
  filePath?: string
  /** Result message */
  message?: string
  /** The path that was operated on */
  path: string
  /** Operation status */
  status: 'failed' | 'success'
  /** Operation type */
  type: CurateOperationType
}

/**
 * Output from curate operations.
 */
export interface CurateResult {
  /** Array of operation results */
  applied: CurateOperationResult[]
  /** Summary counts */
  summary: {
    added: number
    deleted: number
    failed: number
    merged: number
    updated: number
  }
}

/**
 * Options for curate operations.
 */
export interface CurateOptions {
  /** Base path for knowledge storage (default: .brv/context-tree) */
  basePath?: string
}

/**
 * Input for domain detection.
 */
export interface DetectDomainsInput {
  /** Semantically meaningful domain category name (snake_case) */
  category: string
  /** Array of text segments from the input data that relate to this domain */
  textSegments: string[]
}

/**
 * Result from domain detection.
 */
export interface DetectDomainsResult {
  /** Detected domains with their text segments */
  domains: DetectDomainsInput[]
}

/**
 * Curate service interface for sandbox integration.
 * Provides curate and domain detection operations accessible via tools.* in the sandbox.
 */
export interface ICurateService {
  /**
   * Execute curate operations on knowledge topics.
   *
   * @param operations - Array of curate operations to apply
   * @param options - Curate options
   * @returns Curate result with applied operations and summary
   */
  curate(operations: CurateOperation[], options?: CurateOptions): Promise<CurateResult>

  /**
   * Detect and validate domains from input data.
   * This is a pass-through validation that ensures domain names are valid.
   *
   * @param domains - Array of detected domains with text segments
   * @returns Validated domains
   */
  detectDomains(domains: DetectDomainsInput[]): Promise<DetectDomainsResult>
}
