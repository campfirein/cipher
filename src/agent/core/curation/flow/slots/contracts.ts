/**
 * Slot contracts registry — single source of truth for I/O shapes,
 * tool allowlists, and per-slot timeouts.
 *
 * Phase 1: descriptive only. Phase 2 wires enforcement at the sandbox
 * boundary. Phase 3+ adds promotion of agent-supplied node code into
 * the harness store.
 */

import type {NodeSlot} from '../types.js'
import type {SlotContract} from './types.js'

import {
  chunkInputSchema,
  chunkOutputSchema,
  conflictInputSchema,
  conflictOutputSchema,
  dedupInputSchema,
  dedupOutputSchema,
  extractInputSchema,
  extractOutputSchema,
  groupInputSchema,
  groupOutputSchema,
  reconInputSchema,
  reconOutputSchema,
  writeInputSchema,
  writeOutputSchema,
} from './schemas.js'

export const slotContracts: Record<NodeSlot, SlotContract> = {
  chunk: {
    inputSchema: chunkInputSchema,
    outputSchema: chunkOutputSchema,
    slot: 'chunk',
    timeoutMs: 5000,
    toolAllowlist: [],
  },
  conflict: {
    inputSchema: conflictInputSchema,
    outputSchema: conflictOutputSchema,
    slot: 'conflict',
    timeoutMs: 30_000,
    toolAllowlist: ['tools.curation.conflict'],
  },
  dedup: {
    inputSchema: dedupInputSchema,
    outputSchema: dedupOutputSchema,
    slot: 'dedup',
    timeoutMs: 5000,
    toolAllowlist: [],
  },
  extract: {
    inputSchema: extractInputSchema,
    outputSchema: extractOutputSchema,
    slot: 'extract',
    timeoutMs: 60_000,
    toolAllowlist: ['tools.curation.mapExtract'],
  },
  group: {
    inputSchema: groupInputSchema,
    outputSchema: groupOutputSchema,
    slot: 'group',
    timeoutMs: 5000,
    toolAllowlist: [],
  },
  recon: {
    inputSchema: reconInputSchema,
    outputSchema: reconOutputSchema,
    slot: 'recon',
    timeoutMs: 10_000,
    toolAllowlist: ['tools.curation.recon'],
  },
  write: {
    inputSchema: writeInputSchema,
    outputSchema: writeOutputSchema,
    slot: 'write',
    timeoutMs: 30_000,
    toolAllowlist: ['tools.curate'],
  },
}
