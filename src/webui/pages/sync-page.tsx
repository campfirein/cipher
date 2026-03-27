import {PullPanel} from '../features/pull/components/pull-panel'
import {PushPanel} from '../features/push/components/push-panel'

export function SyncPage() {
  return (
    <div className="grid gap-4 grid-cols-2">
      <PushPanel />
      <PullPanel />
    </div>
  )
}
