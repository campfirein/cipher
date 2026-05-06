import type {IAnalyticsClient} from '../../core/interfaces/analytics/i-analytics-client.js'

import {AnalyticsBatch} from '../../core/domain/analytics/batch.js'

/**
 * Default analytics client used by the daemon before the real client is
 * wired (M2.5) and by tests that need a stand-in. `track()` is a true
 * no-op — no buffering, no resolver calls; `flush()` always resolves to
 * an empty batch.
 */
export class NoOpAnalyticsClient implements IAnalyticsClient {
  public async flush(): Promise<AnalyticsBatch> {
    return AnalyticsBatch.create([])
  }

  public track(_event: string, _properties?: Record<string, unknown>): void {
    // intentional no-op
  }
}
