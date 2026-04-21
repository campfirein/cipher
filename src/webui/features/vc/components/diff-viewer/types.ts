export type DiffViewMode = 'split' | 'unified'

export interface DiffViewerProps {
  filename: string
  /** When `true`, hides the built-in summary/title bar. Useful when the caller renders its own header. */
  hideSummary?: boolean
  newContent: string
  oldContent: string
  /** When `true`, hides unchanged lines and shows collapsed fold markers. Defaults to `false` — full file is shown. */
  showDiffOnly?: boolean
  /**
   * When `true` (default), shows an overlay spinner while the library computes line info.
   * Set to `false` when a parent component (e.g. multi-diff) renders its own single loading state.
   */
  showLoadingOverlay?: boolean
  viewMode?: DiffViewMode
}
