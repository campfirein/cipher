import path from 'node:path'

import type {BrvConfig} from '../../../core/domain/entities/brv-config.js'

/**
 * The two context-tree file formats M1 supports.
 *
 * Per the M1 plan: write-side picks per `BrvConfig.useHtmlContextTree`
 * (single decision per flag state, otherwise mixed-format projects would
 * write inconsistently). Read-side picks per file extension so MD and
 * HTML files coexist transparently — necessary because the bench's two
 * configurations operate on isolated dataset directories, but during
 * development we run mixed-format projects (some files migrated, some
 * not).
 */
export type ContextTreeFormat = 'html' | 'markdown'

/**
 * Decide which format to use when writing a curate output.
 *
 * Default is `markdown` (production-safe). The flag flips to `html` when
 * the M1 experiment is active. Read by the curate executor at write
 * site to route between the markdown writer and `html-writer`.
 */
export function getFormatForWrite(config: Pick<BrvConfig, 'useHtmlContextTree'>): ContextTreeFormat {
  return config.useHtmlContextTree === true ? 'html' : 'markdown'
}

/**
 * Decide which format a topic file is in by inspecting its path's
 * extension. Used by the query/search read path so a project can
 * contain both formats during the experiment.
 *
 * Unrecognised extensions default to `markdown` — this keeps the read
 * path forward-compatible with future formats and avoids surprising
 * the existing markdown reader on extension-less or oddly-named files.
 * Add explicit branches when new formats land.
 */
export function getFormatForRead(filePath: string): ContextTreeFormat {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.html' || ext === '.htm') return 'html'
  return 'markdown'
}
