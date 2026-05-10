import type {QueryLogMatchedDoc} from '../../../core/domain/entities/query-log-entry.js'
import type {IFormatDetector} from '../../../core/interfaces/render/i-format-detector.js'

/**
 * Default `IFormatDetector` binding. Always reports `'markdown'` when any
 * docs are present — accurate for the legacy path which produces only `.md`
 * files. Reports `undefined` when no docs were retrieved (e.g. tier 0/1
 * cache hit, tier 4 LLM-only response). The future format-detector binding
 * will replace this with extension-aware detection once HTML files start
 * landing under `.brv/context-tree/`.
 */
export class MarkdownOnlyFormatDetector implements IFormatDetector {
  public detect(matchedDocs: readonly QueryLogMatchedDoc[]): 'html' | 'markdown' | undefined {
    if (matchedDocs.length === 0) return undefined
    return 'markdown'
  }
}
