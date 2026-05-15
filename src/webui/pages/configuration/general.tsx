import {ConnectorsPanel} from '../../features/connectors/components/connectors-panel'
import {ConcurrencyPanel} from '../../features/settings/components/concurrency-panel'
import {TaskHistoryPanel} from '../../features/settings/components/task-history-panel'

export function GeneralSection() {
  return (
    <>
      <ConnectorsPanel />
      <TaskHistoryPanel />
      <ConcurrencyPanel />
    </>
  )
}
