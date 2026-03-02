import {createHash} from 'node:crypto'

/**
 * Computes SHA-256 hash of file content.
 * Accepts both string (decoded text) and Buffer (raw bytes) so that
 * all callers produce identical digests for the same content.
 */
export function computeContentHash(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex')
}
