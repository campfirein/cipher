import {HistoryPanel, HistoryPanelSection} from '@campfirein/byterover-packages/components/contexts/history-panel'
import {TimelineItem} from '@campfirein/byterover-packages/components/contexts/timeline-item'
import {format} from 'date-fns'
import {useMemo} from 'react'

import {useGetContextHistory} from '../api/get-context-history'
import {useContextTree} from '../hooks/use-context-tree'
import {isFilePath} from '../utils/tree-utils'

interface ContextHistoryPanelProps {
  onClose: () => void
}

export function ContextHistoryPanel({onClose}: ContextHistoryPanelProps) {
  const {selectedPath} = useContextTree()

  const {data, error, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading} = useGetContextHistory({
    enabled: Boolean(selectedPath) && isFilePath(selectedPath),
    path: selectedPath,
  })

  const allCommits = useMemo(() => data?.pages.flatMap((page) => page.commits) ?? [], [data])

  const currentCommit = allCommits[0]
  const olderCommits = allCommits.slice(1)

  return (
    <HistoryPanel
      error={Boolean(error)}
      hasNextPage={hasNextPage}
      isEmpty={!currentCommit}
      isFetchingNextPage={isFetchingNextPage}
      isLoading={isLoading}
      onClose={onClose}
      onLoadMore={fetchNextPage}
    >
      {currentCommit && (
        <HistoryPanelSection label="Current">
          <TimelineItem
            authorName={currentCommit.author.name}
            isActive
            title={formatCommitDate(currentCommit.timestamp)}
          />
        </HistoryPanelSection>
      )}

      {olderCommits.length > 0 && (
        <HistoryPanelSection label="Older">
          {olderCommits.map((commit, index) => (
            <TimelineItem
              authorName={commit.author.name}
              isLast={index === olderCommits.length - 1}
              key={commit.sha}
              title={formatCommitDate(commit.timestamp)}
            />
          ))}
        </HistoryPanelSection>
      )}
    </HistoryPanel>
  )
}

function formatCommitDate(timestamp: string): string {
  try {
    return `Updated at ${format(new Date(timestamp), 'MMM d, HH:mm')}`
  } catch {
    return 'Updated'
  }
}
