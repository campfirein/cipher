import {Button} from '@campfirein/byterover-packages/components/button'
import {DialogFooter, DialogHeader, DialogTitle} from '@campfirein/byterover-packages/components/dialog'
import {ChevronLeft} from 'lucide-react'

import type {ProviderDTO} from '../../../../../shared/transport/events'

import {useGetModels} from '../../../model/api/get-models'

export type ProviderActionId = 'activate' | 'change_model' | 'disconnect' | 'reconfigure' | 'reconnect_oauth' | 'replace'

interface ProviderActionStepProps {
  error?: string
  onAction: (actionId: ProviderActionId) => void
  onBack: () => void
  provider: ProviderDTO
}

export function ProviderActionStep({error, onAction, onBack, provider}: ProviderActionStepProps) {
  const {data: modelsData} = useGetModels({providerId: provider.id})
  const activeModel = modelsData?.activeModel
  const isByteRover = provider.id === 'byterover'

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

      <div className="flex flex-col gap-4">
        {error && (
          <div className="text-destructive bg-destructive/10 rounded-lg px-4 py-2.5 text-sm">{error}</div>
        )}

        {isByteRover ? (
          /* ByteRover: Status + Disconnect */
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-foreground text-sm font-medium">Status</span>
              <span className="text-muted-foreground text-sm">
                {provider.isConnected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {provider.isConnected && (
              <Button onClick={() => onAction('disconnect')} size="sm" variant="outline">
                Disconnect
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Model row */}
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-foreground text-sm font-medium">Model</span>
                <span className="text-muted-foreground text-sm">{activeModel ?? 'Not selected'}</span>
              </div>
              <Button onClick={() => onAction('change_model')} size="sm" variant="outline">
                Change
              </Button>
            </div>

            {/* API Key / OAuth row */}
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-foreground text-sm font-medium">
                  {provider.authMethod === 'oauth' ? 'OAuth' : 'API Key'}
                </span>
                <span className="text-muted-foreground text-sm">
                  {provider.authMethod === 'oauth' ? 'Authenticated via browser' : '****************'}
                </span>
              </div>
              <Button onClick={() => onAction('disconnect')} size="sm" variant="outline">
                Disconnect
              </Button>
            </div>
          </>
        )}
      </div>

      {!provider.isCurrent && (
        <DialogFooter className="mt-auto">
          <Button onClick={onBack} variant="secondary">
            Cancel
          </Button>
          <Button onClick={() => onAction('activate')}>
            Active
          </Button>
        </DialogFooter>
      )}
    </div>
  )
}
