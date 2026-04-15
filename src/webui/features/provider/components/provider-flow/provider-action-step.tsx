import { Button } from '@campfirein/byterover-packages/components/button'
import { DialogFooter, DialogHeader, DialogTitle } from '@campfirein/byterover-packages/components/dialog'
import { ChevronLeft } from 'lucide-react'
import { useMemo } from 'react'

import type { ProviderDTO } from '../../../../../shared/transport/events'

export type ProviderActionId = 'activate' | 'disconnect' | 'reconfigure' | 'reconnect_oauth' | 'replace'

interface ProviderAction {
  description: string
  id: ProviderActionId
  name: string
}

interface ProviderActionStepProps {
  error?: string
  onAction: (actionId: ProviderActionId) => void
  onBack: () => void
  provider: ProviderDTO
}

export function ProviderActionStep({ error, onAction, onBack, provider }: ProviderActionStepProps) {
  const actions = useMemo(() => {
    const result: ProviderAction[] = []

    if (!provider.isCurrent) {
      result.push({ description: 'Make this the active provider', id: 'activate', name: 'Set as active' })
    }

    if (provider.id === 'openai-compatible') {
      result.push(
        {description: 'Change base URL and API key', id: 'reconfigure', name: 'Reconfigure'},
      )
    } else if (provider.authMethod === 'oauth') {
      result.push(
        {description: 'Re-authenticate via browser', id: 'reconnect_oauth', name: 'Reconnect OAuth'},
      )
    } else if (provider.requiresApiKey) {
      result.push(
        {description: 'Enter a new API key', id: 'replace', name: 'Replace API key'},
      )
    }

    result.push({description: 'Remove connection and disconnect', id: 'disconnect', name: 'Disconnect'})

    return result
  }, [provider])

  return (
    <div className="flex flex-1 flex-col gap-6">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <button className="hover:bg-muted rounded p-0.5 transition-colors" onClick={onBack} type="button">
            <ChevronLeft className="size-5" />
          </button>
          {provider.name}
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-1">
        {error && (
          <div className="text-destructive bg-destructive/10 mb-2 rounded-lg px-4 py-2.5 text-sm">{error}</div>
        )}

        {actions.map((action) => (
          <button
            className="hover:bg-muted flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors"
            key={action.id}
            onClick={() => onAction(action.id)}
            type="button"
          >
            <span className="text-foreground text-sm font-medium">{action.name}</span>
            <span className="text-muted-foreground text-xs">{action.description}</span>
          </button>
        ))}
      </div>

      <DialogFooter className="mt-auto">
        <Button onClick={onBack} variant="secondary">
          Cancel
        </Button>
      </DialogFooter>
    </div>
  )
}
