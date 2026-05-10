/* eslint-disable camelcase */
import {z} from 'zod'

import type {AnalyticsEventWithIdentity} from './batch.js'

/**
 * Maximum number of send attempts before a record terminates as `'failed'`.
 *
 * Consumed inside `JsonlAnalyticsStore.updateStatus` (M9.2): on a `'failed'`
 * update the store increments `attempts`; the row only transitions to
 * terminal `status='failed'` when `attempts >= MAX_ATTEMPTS`. Otherwise it
 * stays at `status='pending'` so the next flush cycle re-attempts it.
 *
 * M10.3 verifies the composition end-to-end.
 */
export const MAX_ATTEMPTS = 3

/**
 * Local-only status enum for daemon-side persistence. Never serialized to
 * the wire — see `toWireEvent` for the strip path.
 */
const StoredStatusSchema = z.enum(['pending', 'sent', 'failed'])

export type StoredStatus = z.infer<typeof StoredStatusSchema>

/**
 * Mirrors the wire identity schema from `batch.ts` so disk-persisted rows
 * are validated against the same contract events flow through. Kept private
 * here (mirror per M9.1 plan) rather than refactoring `batch.ts` to export
 * its private schemas — keeps M9.1 minimal and avoids touching the M2.6
 * wire boundary.
 */
const IdentityWireSchema = z.object({
  device_id: z.string().refine((s) => s.trim().length > 0, {
    message: 'device_id must be non-empty',
  }),
  email: z.string().optional(),
  name: z.string().optional(),
  user_id: z.string().optional(),
})

/**
 * A local-only stored record. Extends the wire-format
 * `AnalyticsEventWithIdentity` shape with three daemon-internal fields:
 *
 * - `id`: stable per-row identifier (uuid v4) for `updateStatus` mutations
 * - `status`: `'pending' | 'sent' | 'failed'`
 * - `attempts`: number of send attempts (0..MAX_ATTEMPTS)
 *
 * The wire format that goes to the backend (M3+) stays unchanged — these
 * extra fields are local metadata and NEVER leave the daemon. `toWireEvent`
 * is the strip helper M4's HTTP sender uses when shipping a batch.
 */
export const StoredAnalyticsRecordSchema = z.object({
  attempts: z.number().int().min(0),
  id: z.string().min(1),
  identity: IdentityWireSchema,
  name: z.string(),
  properties: z.record(z.string(), z.unknown()),
  status: StoredStatusSchema,
  timestamp: z.number(),
})

/**
 * `Readonly<>` wrapper aligns with the rest of the analytics domain
 * (`Identity`, `AnalyticsEvent`, `AnalyticsEventWithIdentity` are all
 * `Readonly<>`). A stored row is a frozen-in-time snapshot of the disk
 * state; M9.2 mutates by spread + rewrite, never in-place.
 */
export type StoredAnalyticsRecord = Readonly<z.infer<typeof StoredAnalyticsRecordSchema>>

/**
 * Strips local-only fields (`id`, `status`, `attempts`) from a stored
 * record and returns the wire-format `AnalyticsEventWithIdentity` that can
 * be shipped to the backend. M4's HTTP sender uses this on the way out;
 * M9.3 (in-process) and M11.2 (over transport) both keep the local fields
 * for their own purposes.
 */
export function toWireEvent(record: StoredAnalyticsRecord): AnalyticsEventWithIdentity {
  return {
    identity: record.identity,
    name: record.name,
    properties: record.properties,
    timestamp: record.timestamp,
  }
}
