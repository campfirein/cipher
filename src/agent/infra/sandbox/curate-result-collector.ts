import {AsyncLocalStorage} from 'node:async_hooks'

import type {
  CurateOperation,
  CurateOptions,
  CurateResult,
  DetectDomainsInput,
  DetectDomainsResult,
  ICurateService,
} from '../../core/interfaces/i-curate-service.js'

/**
 * Decorator that wraps ICurateService to transparently collect curate() results
 * per executeCode() call, even when multiple calls run concurrently.
 *
 * Uses AsyncLocalStorage so concurrent executeCode() calls each get their own
 * isolated bucket — curate() calls within a sandbox execution automatically
 * propagate through the async context chain to the correct bucket.
 *
 * Usage: const {result, curateResults} = await collector.collect(() => sandbox.execute(...))
 */
export class CurateResultCollector implements ICurateService {
  private readonly storage = new AsyncLocalStorage<unknown[]>()

  constructor(private readonly inner: ICurateService) {}

  async curate(operations: CurateOperation[], options?: CurateOptions): Promise<CurateResult> {
    const result = await this.inner.curate(operations, options)
    this.storage.getStore()?.push(result)
    return result
  }

  detectDomains(domains: DetectDomainsInput[]): Promise<DetectDomainsResult> {
    return this.inner.detectDomains(domains)
  }

  /**
   * Run fn in an isolated async context and collect all curate() results
   * triggered within that context. Concurrent collect() calls are fully isolated.
   */
  async collect<T>(fn: () => Promise<T>): Promise<{curateResults: unknown[]; result: T}> {
    const bucket: unknown[] = []
    const result = await this.storage.run(bucket, fn)
    return {curateResults: bucket, result}
  }
}
