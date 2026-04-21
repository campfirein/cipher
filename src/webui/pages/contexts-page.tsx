import {ContextLayout} from '../features/context/components/context-layout'
import {ContextTreeProvider} from '../features/context/hooks/use-context-tree'

export function ContextsPage() {
  return (
    <ContextTreeProvider>
      <ContextLayout />
    </ContextTreeProvider>
  )
}
