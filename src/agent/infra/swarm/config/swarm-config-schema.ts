/* eslint-disable camelcase -- mapKeys maps on-disk YAML snake_case to camelCase */
import {z} from 'zod'

// ============================================================
// Helper: snake_case → camelCase key mapping
// ============================================================

function mapKeys(
  obj: Record<string, unknown>,
  mapping: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const mappedKey = mapping[key] ?? key
    result[mappedKey] = value
  }

  return result
}

// ============================================================
// Environment variable resolution
// ============================================================

/**
 * Resolve `${VAR}` patterns in a string using the given environment.
 * Returns the original string if the variable is not found.
 */
export function resolveEnvVars(
  value: string,
  env: Record<string, string | undefined>
): string {
  return value.replaceAll(/\$\{(\w+)\}/g, (_match, varName: string) => {
    const envValue = env[varName]

    return envValue ?? `\${${varName}}`
  })
}

// ============================================================
// Provider sub-schemas
// ============================================================

const ByteRoverProviderSchema = z.object({
  enabled: z.boolean(),
})

const ObsidianProviderSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      ignore_patterns: 'ignorePatterns',
      index_on_startup: 'indexOnStartup',
      read_only: 'readOnly',
      vault_path: 'vaultPath',
      watch_for_changes: 'watchForChanges',
    })
  },
  z.object({
    enabled: z.boolean(),
    ignorePatterns: z.array(z.string()).optional(),
    indexOnStartup: z.boolean().optional().default(true),
    readOnly: z.boolean().optional().default(true),
    vaultPath: z.string(),
    watchForChanges: z.boolean().optional().default(true),
  })
)

const LocalMarkdownFolderSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      follow_wikilinks: 'followWikilinks',
      read_only: 'readOnly',
    })
  },
  z.object({
    followWikilinks: z.boolean().optional().default(true),
    name: z.string(),
    path: z.string(),
    readOnly: z.boolean().optional().default(true),
  })
)

const LocalMarkdownProviderSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      watch_for_changes: 'watchForChanges',
    })
  },
  z.object({
    enabled: z.boolean(),
    folders: z.array(LocalMarkdownFolderSchema),
    watchForChanges: z.boolean().optional().default(true),
  })
)

const HonchoProviderSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      api_key: 'apiKey',
      app_id: 'appId',
      max_tokens_per_query: 'maxTokensPerQuery',
      user_id: 'userId',
    })
  },
  z.object({
    apiKey: z.string(),
    appId: z.string(),
    enabled: z.boolean(),
    maxTokensPerQuery: z.number().int().positive().optional().default(4000),
    userId: z.string().optional().default('default'),
  })
)

const HindsightProviderSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      cara_params: 'caraParams',
      connection_string: 'connectionString',
    })
  },
  z.object({
    caraParams: z.object({
      empathy: z.number().min(0).max(1).optional().default(0.5),
      literalism: z.number().min(0).max(1).optional().default(0.5),
      skepticism: z.number().min(0).max(1).optional().default(0.5),
    }).optional(),
    connectionString: z.string(),
    enabled: z.boolean(),
    networks: z.array(z.string()).optional().default(['world', 'experience']),
  })
)

const GBrainProviderSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      connection_string: 'connectionString',
      repo_path: 'repoPath',
      search_mode: 'searchMode',
    })
  },
  z.object({
    connectionString: z.string().optional(),
    enabled: z.boolean(),
    repoPath: z.string(),
    searchMode: z.enum(['hybrid', 'keyword', 'vector']).optional().default('hybrid'),
  })
)

const MemoryWikiProviderSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      boost_fresh: 'boostFresh',
      vault_path: 'vaultPath',
      write_page_type: 'writePageType',
    })
  },
  z.object({
    boostFresh: z.boolean().optional().default(true),
    enabled: z.boolean(),
    vaultPath: z.string(),
    writePageType: z.enum(['concept', 'entity']).optional().default('concept'),
  })
)

// ============================================================
// Top-level sections
// ============================================================

const ProvidersSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      local_markdown: 'localMarkdown',
      memory_wiki: 'memoryWiki',
    })
  },
  z.object({
    byterover: ByteRoverProviderSchema,
    gbrain: GBrainProviderSchema.optional(),
    hindsight: HindsightProviderSchema.optional(),
    honcho: HonchoProviderSchema.optional(),
    localMarkdown: LocalMarkdownProviderSchema.optional(),
    memoryWiki: MemoryWikiProviderSchema.optional(),
    obsidian: ObsidianProviderSchema.optional(),
  })
)

const RoutingSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      classification_method: 'classificationMethod',
      default_max_results: 'defaultMaxResults',
      default_strategy: 'defaultStrategy',
      min_rrf_score: 'minRrfScore',
      rrf_gap_ratio: 'rrfGapRatio',
      rrf_k: 'rrfK',
    })
  },
  z.object({
    classificationMethod: z.enum(['auto', 'llm']).optional().default('auto'),
    defaultMaxResults: z.number().int().positive().optional().default(10),
    defaultStrategy: z.enum(['adaptive', 'all', 'manual']).optional().default('adaptive'),
    minRrfScore: z.number().min(0).optional().default(0.005),
    rrfGapRatio: z.number().gt(0).max(1).optional().default(0.5),
    rrfK: z.number().int().positive().optional().default(60),
  })
)

const PerProviderBudgetSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      max_queries_per_minute: 'maxQueriesPerMinute',
      monthly_cap_cents: 'monthlyCapCents',
    })
  },
  z.object({
    maxQueriesPerMinute: z.number().int().positive().optional(),
    monthlyCapCents: z.number().int().nonnegative(),
  })
)

const BudgetSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      global_monthly_cap_cents: 'globalMonthlyCapCents',
      per_provider: 'perProvider',
      warning_threshold_pct: 'warningThresholdPct',
      weight_reduction_threshold_pct: 'weightReductionThresholdPct',
    })
  },
  z.object({
    globalMonthlyCapCents: z.number().int().nonnegative().optional().default(5000),
    perProvider: z.record(PerProviderBudgetSchema).optional(),
    warningThresholdPct: z.number().int().min(0).max(100).optional().default(80),
    weightReductionThresholdPct: z.number().int().min(0).max(100).optional().default(90),
  })
)

const OptimizationSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      edge_learning: 'edgeLearning',
      template_optimization: 'templateOptimization',
    })
  },
  z.object({
    edgeLearning: z.preprocess(
      (data) => {
        if (typeof data !== 'object' || data === null) return data

        return mapKeys(data as Record<string, unknown>, {
          exploration_rate: 'explorationRate',
          fix_threshold: 'fixThreshold',
          min_observations_to_prune: 'minObservationsToPrune',
          prune_threshold: 'pruneThreshold',
        })
      },
      z.object({
        enabled: z.boolean().optional().default(true),
        explorationRate: z.number().min(0).max(1).optional().default(0.05),
        fixThreshold: z.number().min(0).max(1).optional().default(0.95),
        minObservationsToPrune: z.number().int().positive().optional().default(100),
        pruneThreshold: z.number().min(0).max(1).optional().default(0.05),
      })
    ).optional().default({}),
    templateOptimization: z.preprocess(
      (data) => {
        if (typeof data !== 'object' || data === null) return data

        return mapKeys(data as Record<string, unknown>, {
          ab_test_size: 'abTestSize',
          failure_rate_trigger: 'failureRateTrigger',
        })
      },
      z.object({
        abTestSize: z.number().int().positive().optional().default(5),
        enabled: z.boolean().optional().default(true),
        failureRateTrigger: z.number().min(0).max(1).optional().default(0.3),
        frequency: z.number().int().positive().optional().default(20),
      })
    ).optional().default({}),
  })
)

const ProvenanceSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      full_retention_days: 'fullRetentionDays',
      keep_summaries: 'keepSummaries',
      storage_path: 'storagePath',
    })
  },
  z.object({
    enabled: z.boolean().optional().default(true),
    fullRetentionDays: z.number().int().positive().optional().default(30),
    keepSummaries: z.boolean().optional().default(true),
    storagePath: z.string().optional().default('swarm/provenance'),
  })
)

const PerformanceSchema = z.preprocess(
  (data) => {
    if (typeof data !== 'object' || data === null) return data

    return mapKeys(data as Record<string, unknown>, {
      file_watcher_debounce_ms: 'fileWatcherDebounceMs',
      index_cache_ttl_seconds: 'indexCacheTtlSeconds',
      max_concurrent_providers: 'maxConcurrentProviders',
      max_query_latency_ms: 'maxQueryLatencyMs',
      result_cache_ttl_ms: 'resultCacheTtlMs',
    })
  },
  z.object({
    fileWatcherDebounceMs: z.number().int().positive().optional().default(1000),
    indexCacheTtlSeconds: z.number().int().optional().default(300),
    maxConcurrentProviders: z.number().int().positive().optional().default(4),
    maxQueryLatencyMs: z.number().int().positive().optional().default(2000),
    resultCacheTtlMs: z.number().int().min(0).optional().default(10_000),
  })
)

const EnrichmentEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
})

const EnrichmentSchema = z.object({
  edges: z.array(EnrichmentEdgeSchema).optional().default([]),
})

// ============================================================
// Root schema
// ============================================================

/**
 * Full Zod schema for `.brv/swarm/config.yaml`.
 * Accepts snake_case YAML input and outputs camelCase TypeScript.
 */
export const SwarmConfigSchema = z.object({
  budget: BudgetSchema.optional(),
  enrichment: EnrichmentSchema.optional().default({}),
  optimization: OptimizationSchema.optional().default({}),
  performance: PerformanceSchema.optional().default({}),
  provenance: ProvenanceSchema.optional().default({}),
  providers: ProvidersSchema,
  routing: RoutingSchema.optional().default({}),
})

/**
 * Validated swarm configuration type (camelCase TypeScript output).
 */
export type SwarmConfig = z.output<typeof SwarmConfigSchema>

/**
 * Validate swarm config (throwing).
 * @throws ZodError on invalid input
 */
export function validateSwarmConfig(config: unknown): SwarmConfig {
  return SwarmConfigSchema.parse(config)
}

/**
 * Validate swarm config (non-throwing).
 * Returns a SafeParseResult with success/error.
 */
export function safeValidateSwarmConfig(config: unknown): z.SafeParseReturnType<unknown, SwarmConfig> {
  return SwarmConfigSchema.safeParse(config)
}
