/**
 * Redact a `passphrase` field from an object while preserving the rest.
 *
 * Use this wherever a request/response payload that may carry a passphrase
 * is about to be logged, serialised into an error, stringified for telemetry,
 * or echoed back to a client: never let the raw secret leave the in-memory
 * handler that consumes it.
 *
 * Generic over any object that has an optional `passphrase: string` — which
 * today is `IVcCommitRequest` (shared/transport/events/vc-events.ts) but may
 * grow in the future.
 */
export function scrubPassphrase<T extends {passphrase?: string}>(payload: T): T {
  if (payload.passphrase === undefined || payload.passphrase === '') return payload
  return {...payload, passphrase: '***'}
}
