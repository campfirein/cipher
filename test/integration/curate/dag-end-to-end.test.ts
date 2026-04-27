/**
 * Phase 1 sanity check — runs the default curate DAG end-to-end via the
 * TopologicalCurationRunner with stub services. Proves the 7 default
 * nodes wire together correctly under a real Kahn's execution.
 */

import {expect} from 'chai'
import {stub} from 'sinon'

import type {NodeContext, NodeServices} from '../../../src/agent/core/curation/flow/runner.js'

import {TopologicalCurationRunner} from '../../../src/agent/core/curation/flow/runner.js'
import {buildCurationDAG} from '../../../src/agent/infra/curation/flow/dag-builder.js'

describe('curate DAG — end-to-end smoke test', () => {
  it('runs the full 7-slot default DAG and produces a write outcome', async () => {
    const services: NodeServices = {
      detectConflicts: stub().resolves({
        decisions: [
          {action: 'add' as const, fact: {statement: 'JWT expires in 24h', subject: 'auth'}},
        ],
      }),
      extract: stub().resolves({
        facts: [{statement: 'JWT expires in 24h', subject: 'auth'}],
        failed: 0,
        succeeded: 1,
        total: 1,
      }),
      write: stub().resolves({
        applied: [
          {
            confidence: 'high' as const,
            impact: 'low' as const,
            needsReview: false,
            path: 'auth/jwt.md',
            reason: 'Documenting JWT',
            status: 'success' as const,
            type: 'ADD' as const,
          },
        ],
        summary: {added: 1, deleted: 0, failed: 0, merged: 0, updated: 0},
      }),
    }

    const ctx: NodeContext = {
      initialInput: {
        context: 'JWT tokens expire in 24h. Stored in httpOnly cookies.',
        history: {},
        meta: {},
      },
      services,
      taskId: 'e2e-task',
    }

    const dag = buildCurationDAG()
    const runner = new TopologicalCurationRunner()
    const result = await runner.run(dag, ctx)

    expect(result.failures, JSON.stringify(result.failures)).to.be.empty

    // Every slot produced an output
    for (const slot of ['recon', 'chunk', 'extract', 'group', 'dedup', 'conflict', 'write']) {
      expect(result.outputs.has(slot), `output for ${slot} present`).to.be.true
    }

    // Final write summary visible
    const writeOut = result.outputs.get('write') as {
      applied: unknown[]
      summary: {added: number; deleted: number; failed: number; merged: number; updated: number}
    }
    expect(writeOut.summary.added).to.equal(1)
    expect(writeOut.summary.failed).to.equal(0)
  })

  it('runs end-to-end even when input has no facts (empty short-circuit)', async () => {
    const services: NodeServices = {
      // Extract returns no facts → group/dedup/conflict/write all short-circuit
      detectConflicts: stub().resolves({decisions: []}),
      extract: stub().resolves({facts: [], failed: 0, succeeded: 0, total: 0}),
      write: stub().resolves({
        applied: [],
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
      }),
    }

    const ctx: NodeContext = {
      initialInput: {context: '', history: {}, meta: {}},
      services,
      taskId: 'e2e-empty',
    }

    const dag = buildCurationDAG()
    const runner = new TopologicalCurationRunner()
    const result = await runner.run(dag, ctx)

    expect(result.failures, JSON.stringify(result.failures)).to.be.empty
    const writeOut = result.outputs.get('write') as {summary: {added: number}}
    expect(writeOut.summary.added).to.equal(0)
  })
})
