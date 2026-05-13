import type {BvProps} from './types'

export function BvTask({children}: BvProps) {
  return (
    <aside className="bv-task-aside">
      <span className="bv-task-aside__label">Task</span>
      <div className="bv-task-aside__body">{children}</div>
    </aside>
  )
}
