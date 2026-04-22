import { LoaderCircle } from 'lucide-react'
import ReactDiffViewer, { DiffMethod, type ReactDiffViewerStylesOverride } from 'react-diff-viewer-continued'

import type { DiffViewerProps } from '../types'

/**
 * Rendered by `react-diff-viewer-continued` while its Web Worker computes line info.
 * Overlays the library's always-visible sticky summary so the filename and diff rows
 * appear together (no title-first flash).
 */
function DiffLoadingOverlay() {
  return (
    <div className="bg-card absolute inset-0 z-20 flex items-center justify-center">
      <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
    </div>
  )
}

const styles: ReactDiffViewerStylesOverride = {
  codeFoldGutter: {
    cursor: 'pointer',
  },
  contentText: {
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: '1.6',
  },
  diffContainer: {
    '& pre': {
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
  },
  gutter: {
    '& pre': {
      color: 'var(--muted-foreground)',
      opacity: 0.7,
    },
    minWidth: '2.5rem',
    padding: '0 10px',
    userSelect: 'none',
  },
  line: {
    '&:hover': {
      background: 'color-mix(in oklch, var(--muted) 40%, transparent)',
    },
  },
  lineNumber: {
    color: 'var(--muted-foreground)',
    opacity: 0.7,
  },
  marker: {
    paddingLeft: '8px',
    paddingRight: '4px',
  },
  titleBlock: {
    borderBottom: '1px solid var(--border)',
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    padding: '10px 12px',
  },
  variables: {
    dark: {
      addedBackground: 'color-mix(in oklch, var(--primary) 18%, transparent)',
      addedColor: 'var(--foreground)',
      addedGutterBackground: 'color-mix(in oklch, var(--primary) 26%, transparent)',
      addedGutterColor: 'var(--muted-foreground)',
      codeFoldBackground: 'var(--muted)',
      codeFoldContentColor: 'var(--muted-foreground)',
      codeFoldGutterBackground: 'var(--muted)',
      diffViewerBackground: 'var(--card)',
      diffViewerColor: 'var(--foreground)',
      diffViewerTitleBackground: 'var(--muted)',
      diffViewerTitleBorderColor: 'var(--border)',
      diffViewerTitleColor: 'var(--foreground)',
      emptyLineBackground: 'var(--card)',
      gutterBackground: 'var(--card)',
      gutterBackgroundDark: 'var(--card)',
      gutterColor: 'var(--muted-foreground)',
      highlightBackground: 'color-mix(in oklch, var(--accent) 30%, transparent)',
      highlightGutterBackground: 'color-mix(in oklch, var(--accent) 40%, transparent)',
      removedBackground: 'color-mix(in oklch, var(--destructive) 16%, transparent)',
      removedColor: 'var(--foreground)',
      removedGutterBackground: 'color-mix(in oklch, var(--destructive) 24%, transparent)',
      removedGutterColor: 'var(--muted-foreground)',
      wordAddedBackground: 'color-mix(in oklch, var(--primary) 40%, transparent)',
      wordRemovedBackground: 'color-mix(in oklch, var(--destructive) 36%, transparent)',
    },
  },
}

export function ReactDiffViewerContinuedBackend({ filename, hideSummary = false, newContent, oldContent, showDiffOnly = false, showLoadingOverlay = true, viewMode = 'split' }: DiffViewerProps) {
  return (
    <ReactDiffViewer
      compareMethod={DiffMethod.WORDS}
      hideSummary={hideSummary}
      loadingElement={showLoadingOverlay ? DiffLoadingOverlay : undefined}
      newValue={newContent}
      oldValue={oldContent}
      showDiffOnly={showDiffOnly}
      splitView={viewMode === 'split'}
      styles={styles}
      summary={filename}
      useDarkTheme
    />
  )
}
