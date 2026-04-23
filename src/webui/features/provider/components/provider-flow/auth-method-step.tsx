import { Button } from '@campfirein/byterover-packages/components/button'
import { DialogFooter, DialogHeader, DialogTitle } from '@campfirein/byterover-packages/components/dialog'
import { ChevronLeft, Globe, Key } from 'lucide-react'

import type { ProviderDTO } from '../../../../../shared/transport/events'

interface AuthMethodStepProps {
  onBack: () => void
  onSelect: (method: 'api-key' | 'oauth') => void
  provider: ProviderDTO
}

export function AuthMethodStep({ onBack, onSelect, provider }: AuthMethodStepProps) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <button className="hover:bg-muted rounded p-0.5 transition-colors" onClick={onBack} type="button">
            <ChevronLeft className="size-5" />
          </button>
          Connect {provider.name}
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <button
          className="hover:bg-muted flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors"
          onClick={() => onSelect('oauth')}
          type="button"
        >
          <Globe className="text-muted-foreground size-5" />
          <div className="flex flex-col">
            <span className="text-foreground text-sm font-medium">{provider.oauthLabel ?? 'Sign in with browser'}</span>
            <span className="text-muted-foreground text-xs">Authenticate via OAuth in your browser</span>
          </div>
        </button>

        <button
          className="hover:bg-muted flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors"
          onClick={() => onSelect('api-key')}
          type="button"
        >
          <Key className="text-muted-foreground size-5" />
          <div className="flex flex-col">
            <span className="text-foreground text-sm font-medium">Enter API key</span>
            <span className="text-muted-foreground text-xs">Paste your API key manually</span>
          </div>
        </button>
      </div>

      <DialogFooter className="mt-auto">
        <Button onClick={onBack} variant="secondary">
          Cancel
        </Button>
      </DialogFooter>
    </div>
  )
}
