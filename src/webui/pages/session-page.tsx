import {ResetPanel} from '../features/reset/components/reset-panel'
import {SessionPanel} from '../features/session/components/session-panel'

export function SessionPage() {
  return (
    <div className="flex flex-col gap-4">
      <SessionPanel />
      <ResetPanel />
    </div>
  )
}
