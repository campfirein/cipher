/**
 * AutoHarness V2 — core types and Zod schemas.
 *
 * Models the per-project learned harness functions, their outcomes
 * from sandbox `code_exec` calls, and the evaluation scenarios used
 * by the refinement loop.
 */

import {z} from 'zod'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Harness operating mode, selected from the per-(projectId, commandType)
 * heuristic H.
 *
 *  - `assisted`: LLM orchestrates, harness is a helper
 *  - `filter`:   LLM reviews proposals from the harness
 *  - `policy`:   harness runs autonomously (safety caps required)
 */
export const HarnessModeSchema = z.enum(['assisted', 'filter', 'policy'])
export type HarnessMode = z.output<typeof HarnessModeSchema>

/**
 * Capability tags a harness declares in its meta block. Drives which
 * code paths can call which harness functions.
 */
export const HarnessCapabilitySchema = z.enum([
  'discover',
  'extract',
  'buildOps',
  'search',
  'gather',
  'curate',
  'answer',
])
export type HarnessCapability = z.output<typeof HarnessCapabilitySchema>

/**
 * Project-type namespace. Partitions outcomes and scenarios so
 * cross-project harness aggregation is a query change, not a
 * migration.
 */
export const ProjectTypeSchema = z.enum(['typescript', 'python', 'generic'])
export type ProjectType = z.output<typeof ProjectTypeSchema>

/**
 * Template language for harness bootstrap. Superset of `ProjectType`:
 * derives its members from `ProjectTypeSchema.options` and adds `'auto'`
 * for runtime detection. A detected project pins to one of the
 * `ProjectType` members; `'auto'` is only valid as a user-facing config
 * value. Deriving (rather than listing) keeps the two enums in sync if
 * a new project type is ever added.
 */
export const HarnessLanguageSchema = z.enum([...ProjectTypeSchema.options, 'auto'] as const)
export type HarnessLanguage = z.output<typeof HarnessLanguageSchema>

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

/**
 * Metadata block embedded in every `HarnessVersion`. Describes what the
 * harness can do and which project patterns it was trained against.
 *
 * Invariant (enforced at the storage layer, not the schema): the `version`
 * field here must equal the enclosing `HarnessVersion.version`. They are
 * modelled separately because `meta` reflects what the harness code declares
 * about itself, while `HarnessVersion.version` is the store-assigned
 * monotonic counter. Consolidation is a candidate cleanup once Phase 1 wires
 * the store and the invariant becomes concrete.
 */
export const HarnessMetaSchema = z
  .object({
    capabilities: z.array(HarnessCapabilitySchema),
    commandType: z.string().min(1),
    projectPatterns: z.array(z.string()),
    version: z.number().int().positive(),
  })
  .strict()
export type HarnessMeta = z.input<typeof HarnessMetaSchema>
export type ValidatedHarnessMeta = z.output<typeof HarnessMetaSchema>

/**
 * One immutable version of a harness. Templates are written as v1;
 * refinements produce v2, v3, … each pointing to its parent. The store
 * prunes old versions per `config.harness.maxVersions`.
 */
export const HarnessVersionSchema = z
  .object({
    code: z.string().min(1),
    commandType: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    heuristic: z.number().min(0).max(1),
    id: z.string().min(1),
    metadata: HarnessMetaSchema,
    parentId: z.string().min(1).optional(),
    projectId: z.string().min(1),
    projectType: ProjectTypeSchema,
    version: z.number().int().positive(),
  })
  .strict()
export type HarnessVersion = z.input<typeof HarnessVersionSchema>
export type ValidatedHarnessVersion = z.output<typeof HarnessVersionSchema>

/**
 * One recorded sandbox `code_exec` outcome. Drives the heuristic H,
 * feeds the refinement evaluator, and carries the user-feedback flag.
 *
 * `harnessVersionId` attributes the outcome to a specific harness version
 * when one was injected. The invariant `usedHarness === true ⇒
 * harnessVersionId is set` is enforced at the recorder (Phase 2), not the
 * schema, because an LLM-driven outcome with `usedHarness === false` has
 * no version to link.
 *
 * `userFeedback` distinguishes four states:
 *   - `undefined` — never flagged by the user
 *   - `null`      — user explicitly cleared a prior flag
 *   - `'good'`    — user flagged as good
 *   - `'bad'`     — user flagged as bad
 * The weighting policy lives upstream in the outcome-recorder, which
 * inserts synthetic outcomes per verdict.
 *
 * `executionTimeMs` is fractional (from `performance.now()`) and must not
 * be constrained to integer.
 */
export const CodeExecOutcomeSchema = z
  .object({
    code: z.string(),
    commandType: z.string().min(1),
    curateResult: z.unknown().optional(),
    delegated: z.boolean().optional(),
    executionTimeMs: z.number().nonnegative(),
    harnessVersionId: z.string().min(1).optional(),
    id: z.string().min(1),
    projectId: z.string().min(1),
    projectType: ProjectTypeSchema,
    queryResult: z.unknown().optional(),
    sessionId: z.string().min(1),
    stderr: z.string().optional(),
    stdout: z.string().optional(),
    success: z.boolean(),
    timestamp: z.number().int().nonnegative(),
    usedHarness: z.boolean(),
    userFeedback: z.enum(['good', 'bad']).nullable().optional(),
  })
  .strict()
export type CodeExecOutcome = z.input<typeof CodeExecOutcomeSchema>
export type ValidatedCodeExecOutcome = z.output<typeof CodeExecOutcomeSchema>

/**
 * A captured test scenario used to evaluate candidate harness versions.
 * Scenarios come from both successful AND failed sessions — negative
 * scenarios prevent the refiner from "improving" into a harness that
 * succeeds by damaging data.
 */
export const EvaluationScenarioSchema = z
  .object({
    code: z.string().min(1),
    commandType: z.string().min(1),
    expectedBehavior: z.string().min(1),
    id: z.string().min(1),
    projectId: z.string().min(1),
    projectType: ProjectTypeSchema,
    taskDescription: z.string().min(1),
  })
  .strict()
export type EvaluationScenario = z.input<typeof EvaluationScenarioSchema>
export type ValidatedEvaluationScenario = z.output<typeof EvaluationScenarioSchema>

// ---------------------------------------------------------------------------
// Config re-export
// ---------------------------------------------------------------------------

// Callers in the harness module import `HarnessConfig` from here rather
// than reaching into `agent-schemas.ts`. `type`-only re-export keeps the
// runtime-module graph acyclic.
export type {HarnessConfig, ValidatedHarnessConfig} from '../agent/agent-schemas.js'
