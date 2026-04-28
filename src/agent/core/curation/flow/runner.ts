/**
 * Topological curation runner.
 *
 * Phase 1 — executes a `CurationDAG` via Kahn's algorithm with `pMap`
 * bounded concurrency at each topological level. Per-node fail-open:
 * if a node throws, the failure is recorded and downstream branches
 * fed by that node's output are skipped, while parallel branches
 * continue. Cycle detection: if Kahn's leaves any node with non-zero
 * in-degree, throws `CycleDetectedError`.
 *
 * Phase 2 — every node executes inside a per-slot sandbox (timeout +
 * tool allowlist + parent-signal propagation) and through a soft-mode
 * schema gate (records validation issues without stranding downstream).
 * The sandbox is the substrate Phase 3 plugs into when agent-supplied
 * JS code starts running inside the slot. `ctx.sandboxed = false` is a
 * test escape hatch for tests using synthetic input shapes.
 *
 * Algorithm port reference:
 *   - GPTSwarm/swarm/graph/graph.py:111 (Kahn's)
 *   - byterover-cli/src/agent/infra/swarm/engine/swarm-graph.ts (cycle detection)
 *
 * Input plumbing convention (consumed by `node.execute(input, ctx)`):
 *   - 0 predecessors → input = `ctx.initialInput`
 *   - 1 predecessor  → input = predecessor's output verbatim
 *   - N predecessors → input = `Record<predecessorNodeId, output>`
 *
 * Phase 1 default DAG is purely linear (recon → ... → write), so the
 * 0/1-predecessor cases dominate. The N-predecessor case exists for
 * forward-compat with Phase 8 positional insertions.
 */

import type {z} from 'zod'

import pMap from 'p-map'

import type {
  conflictOutputSchema,
  extractOutputSchema,
  writeOutputSchema,
} from './slots/schemas.js'
import type {NodeSlot} from './types.js'

import {type MetricsCollector} from './metrics.js'
import {SchemaValidationError} from './sandbox/errors.js'
import {validateAndRun} from './sandbox/schema-gate.js'
import {buildSlotSandbox} from './sandbox/slot-sandbox-builder.js'
import {slotContracts} from './slots/contracts.js'

/**
 * Per-slot service functions injected by Task 1.8 (cutover) and stubbed
 * in node-level tests. Phase 2 will replace direct calls with sandboxed
 * execution; the service interface stays the same so node code does not
 * need to change.
 */
export interface NodeServices {
  /**
   * Detect conflicts between newly extracted facts and existing memory.
   *
   * The implementation is responsible for looking up its own existing
   * memory (e.g., via SearchKnowledgeService). Earlier versions threaded
   * an `existing` parameter from `ctx.initialInput.existing`, but the
   * live adapter ignored it (test/prod mismatch); the signature is kept
   * single-arg to keep both stubs and production aligned.
   */
  readonly detectConflicts?: (
    facts: ReadonlyArray<{statement: string; subject?: string}>,
  ) => Promise<z.infer<typeof conflictOutputSchema>>
  /** Run LLM extraction on a single chunk. */
  readonly extract?: (
    chunk: string,
    taskId: string,
  ) => Promise<z.infer<typeof extractOutputSchema>>
  /** Apply conflict decisions to the context tree via curate-tool. */
  readonly write?: (
    decisions: z.infer<typeof conflictOutputSchema>['decisions'],
  ) => Promise<z.infer<typeof writeOutputSchema>>
}

export interface CurationNode<In, Out> {
  execute(input: In, ctx: NodeContext): Promise<Out>
  readonly id: string
  readonly slot: NodeSlot
}

export interface CurationDAG {
  readonly edges: ReadonlyArray<{from: string; to: string}>
  readonly entryNodeIds: ReadonlyArray<string>
  readonly exitNodeIds: ReadonlyArray<string>
  readonly maxConcurrency: number
  readonly nodes: Readonly<Record<string, CurationNode<unknown, unknown>>>
}

export interface NodeContext {
  /**
   * Concurrency for ExtractNode's per-chunk fan-out (Phase 2 Task 2.4).
   * Defaults to 4 inside `extract-node.ts`. Tunable via curate-executor.
   */
  readonly extractConcurrency?: number
  readonly initialInput?: unknown
  readonly metricsCollector?: MetricsCollector
  /**
   * When true (default), every node runs through the per-slot sandbox
   * (timeout + tool allowlist + parent-signal propagation) and a
   * soft-mode schema gate. Set false ONLY in tests using synthetic
   * input shapes that don't match the real slot schemas.
   */
  readonly sandboxed?: boolean
  readonly services?: NodeServices
  /**
   * Externally-provided abort signal. Propagated to every node's slot
   * sandbox so cancelling the parent (e.g., daemon shutdown) cascades
   * into per-slot AbortControllers.
   */
  readonly signal?: AbortSignal
  /**
   * Per-test override of `slotContracts[slot].timeoutMs`. Lets timeout
   * tests run in tens of milliseconds without changing real defaults.
   */
  readonly slotTimeoutOverrideMs?: number
  readonly taskId: string
  /**
   * Tools surface exposed inside the sandbox. Phase 2 default nodes
   * don't touch `tools.*` (they call `ctx.services.*` via closure), so
   * an empty `{}` is the production default. Phase 3 wires the real
   * `ToolsSDK` here when agent-supplied JS starts running in-slot.
   */
  readonly tools?: Record<string, unknown>
}

export interface CurationRunResult {
  readonly failures: ReadonlyArray<{error: string; nodeId: string}>
  readonly outputs: Map<string, unknown>
}

export class CycleDetectedError extends Error {
  constructor(remainingNodeIds: ReadonlyArray<string>) {
    super(
      `Cycle detected in curation DAG: ${remainingNodeIds.length} node(s) still have unresolved predecessors after topological sort: ${remainingNodeIds.join(', ')}`,
    )
    this.name = 'CycleDetectedError'
  }
}

export class TopologicalCurationRunner {
  public async run(graph: CurationDAG, ctx: NodeContext): Promise<CurationRunResult> {
    const nodeIds = Object.keys(graph.nodes)
    const inDegree = new Map<string, number>()
    const successors = new Map<string, string[]>()
    const predecessors = new Map<string, string[]>()

    for (const id of nodeIds) {
      inDegree.set(id, 0)
      successors.set(id, [])
      predecessors.set(id, [])
    }

    for (const {from, to} of graph.edges) {
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1)
      successors.get(from)?.push(to)
      predecessors.get(to)?.push(from)
    }

    const outputs = new Map<string, unknown>()
    const failures: Array<{error: string; nodeId: string}> = []
    const failed = new Set<string>()
    const completed = new Set<string>()

    let ready = nodeIds.filter((id) => inDegree.get(id) === 0)

    while (ready.length > 0) {
      const batch = ready
      ready = []

      // eslint-disable-next-line no-await-in-loop
      await pMap(
        batch,
        async (nodeId) => {
          const preds = predecessors.get(nodeId) ?? []

          // Skip if any predecessor failed — downstream is stranded.
          if (preds.some((p) => failed.has(p))) {
            failed.add(nodeId)
            failures.push({error: `skipped: predecessor failed`, nodeId})
            return
          }

          let input: unknown
          if (preds.length === 0) {
            input = ctx.initialInput
          } else if (preds.length === 1) {
            input = outputs.get(preds[0])
          } else {
            const merged: Record<string, unknown> = {}
            for (const p of preds) {
              merged[p] = outputs.get(p)
            }

            input = merged
          }

          const node = graph.nodes[nodeId]
          ctx.metricsCollector?.startNode(node.slot)
          try {
            const output = await this.executeNode(node, input, ctx)
            outputs.set(nodeId, output.value)
            completed.add(nodeId)
            // Soft-mode schema warnings: record but treat output as valid
            // for downstream so a too-strict schema doesn't strand the rest
            // of the graph (Phase 2 plan §11 finding F5).
            if (output.warning) {
              failures.push({error: output.warning, nodeId})
            }
          } catch (error) {
            failed.add(nodeId)
            const message = error instanceof Error ? error.message : String(error)
            failures.push({error: message, nodeId})
          } finally {
            ctx.metricsCollector?.endNode(node.slot)
          }
        },
        {concurrency: Math.max(1, graph.maxConcurrency)},
      )

      // Release successors whose predecessors are all settled (completed or failed).
      for (const nodeId of batch) {
        for (const succId of successors.get(nodeId) ?? []) {
          inDegree.set(succId, (inDegree.get(succId) ?? 0) - 1)
          if (
            inDegree.get(succId) === 0 &&
            !completed.has(succId) &&
            !failed.has(succId)
          ) {
            ready.push(succId)
          }
        }
      }
    }

    // Cycle check: any node not yet settled means it has an in-edge cycle.
    const unsettled = nodeIds.filter((id) => !completed.has(id) && !failed.has(id))
    if (unsettled.length > 0) {
      throw new CycleDetectedError(unsettled)
    }

    return {failures, outputs}
  }

  /**
   * Wraps a node execution with the per-slot sandbox + soft-mode schema
   * gate. Returns the node's output value and an optional warning string
   * (set when the schema gate flags input/output as invalid but we elect
   * to keep the data flowing — Phase 2 plan §11 finding F5).
   *
   * `ToolAccessViolation` and `NodeTimeoutError` propagate as thrown
   * errors so the caller can mark the node failed and strand downstream.
   */
  private async executeNode(
    node: CurationNode<unknown, unknown>,
    input: unknown,
    ctx: NodeContext,
  ): Promise<{value: unknown; warning?: string}> {
    const sandboxed = ctx.sandboxed ?? true

    if (!sandboxed) {
      const value = await node.execute(input, ctx)
      return {value}
    }

    const contract = slotContracts[node.slot]
    const sandbox = buildSlotSandbox(node.slot, ctx.tools ?? {}, {
      parentSignal: ctx.signal,
      timeoutMsOverride: ctx.slotTimeoutOverrideMs,
    })

    const gateResult = await sandbox.runInSlot(async ({signal, tools}) => {
      // Thread the proxied tools (allowlist-enforced) into slotCtx along
      // with the per-slot signal. CRITICAL: spreading `...ctx` first then
      // overriding tools/signal — if we kept `ctx.tools`, nodes could
      // bypass the allowlist by reaching into the unfiltered surface.
      // (PHASE-2-CODE-REVIEW E1.)
      const slotCtx: NodeContext = {...ctx, signal, tools}
      return validateAndRun({
        fn: async (validatedInput) => node.execute(validatedInput, slotCtx),
        input,
        inputSchema: contract.inputSchema,
        mode: 'soft',
        outputSchema: contract.outputSchema,
        slot: node.slot,
      })
    })

    if (gateResult.ok) {
      return {value: gateResult.value}
    }

    // Output soft-fail (PHASE-2-CODE-REVIEW W4 + plan §11 finding F5):
    // when the OUTPUT shape drifts, forward `rawOutput` so downstream
    // can still consume the data; record a non-fatal warning. The raw
    // output has the right schema family — only some field is off.
    //
    // INPUT-fail strands (W4 fix): when the INPUT shape is wrong, we
    // have NO output to forward — passing raw `input` (which has a
    // different schema family entirely) cascades confusing warnings
    // across every downstream node. Throwing here strands downstream
    // with a single clear failure, which is what the user expects.
    if (gateResult.phase === 'input') {
      throw new SchemaValidationError(node.slot, 'input', gateResult.issues)
    }

    const issueSummary = gateResult.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ')
    const warning = `slot '${node.slot}' output schema warning: ${issueSummary}`

    return {value: gateResult.rawOutput, warning}
  }
}
