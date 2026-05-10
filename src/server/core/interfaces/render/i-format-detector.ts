import type {QueryLogMatchedDoc} from '../../domain/entities/query-log-entry.js'

/**
 * Strategy for deciding the `format` field on a populated `QueryLogEntry`.
 * Receives the docs the recall touched and reports `'html'`, `'markdown'`,
 * or `undefined` (no docs touched).
 *
 * The default binding is {@link MarkdownOnlyFormatDetector}. Swap to an
 * extension-aware implementation once HTML files start landing under
 * `.brv/context-tree/`.
 */
export interface IFormatDetector {
  detect(matchedDocs: readonly QueryLogMatchedDoc[]): 'html' | 'markdown' | undefined
}
