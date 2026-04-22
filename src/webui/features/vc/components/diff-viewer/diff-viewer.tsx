import type {DiffViewerProps} from './types'

import {ReactDiffViewerContinuedBackend} from './backends/react-diff-viewer-continued-backend'

/**
 * Stable wrapper over a pluggable diff renderer backend.
 * Swap the backend component below to change the implementation
 * (e.g. to Monaco or a custom renderer) without touching callers.
 */
export function DiffViewer(props: DiffViewerProps) {
  return <ReactDiffViewerContinuedBackend {...props} />
}
