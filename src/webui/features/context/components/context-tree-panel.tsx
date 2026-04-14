import { TreeView, TreeViewSkeleton } from '@campfirein/byterover-packages/components/contexts/tree-view'

import { useContextTree } from '../hooks/use-context-tree'
import { ContextTreeHeaderItem } from './context-tree-header-item'

interface ContextTreePanelProps {
  onCollapse?: () => void
}

export function ContextTreePanel({onCollapse}: ContextTreePanelProps) {
  const { expandedPaths, flattenedNodes, handleSelect, handleToggle, isFetchingTree, selectedPath } = useContextTree()

  if (isFetchingTree && flattenedNodes.length === 0) {
    return <TreeViewSkeleton className="p-2" count={8} />
  }

  return (
    <TreeView
      expandedPaths={expandedPaths}
      header={<ContextTreeHeaderItem onCollapseClick={onCollapse} />}
      nodes={flattenedNodes}
      onSelect={handleSelect}
      onToggle={handleToggle}
      selectedPath={selectedPath}
    />
  )
}
