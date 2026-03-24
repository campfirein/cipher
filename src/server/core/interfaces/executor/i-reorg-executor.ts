import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'

export interface ReorgCandidate {
  confidence: number
  detectionMetadata: Record<string, unknown>
  reason: string
  sourcePaths: string[]
  targetPath: string
  type: 'merge' | 'move'
}

export interface ReorgQualityMetrics {
  /** For move: keyword alignment with target domain [0,1] */
  postDomainAlignment?: number
  /** For merge: keyword count after merge (deduplicated) */
  postKeywordCount?: number
  /** For move: keyword alignment with original domain [0,1] */
  preDomainAlignment?: number
  /** For merge: keyword count before merge (sum of both entries) */
  preKeywordCount?: number
}

export interface ReorgResult {
  candidate: ReorgCandidate
  changedPaths: string[]
  error?: string
  /** Quality metrics for detector training (not just executor success) */
  qualityMetrics?: ReorgQualityMetrics
  success: boolean
}

export interface ReorgExecutionSummary {
  candidatesDetected: number
  candidatesExecuted: number
  candidatesSkipped: number
  results: ReorgResult[]
  templateNodeId?: string
}

export interface IReorgExecutor {
  detectAndExecute(params: {
    agent: ICipherAgent
    contextTreeDir: string
    dryRun?: boolean
    projectBaseDir: string
  }): Promise<ReorgExecutionSummary>
}
