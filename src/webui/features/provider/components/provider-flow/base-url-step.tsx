import { Button } from '@campfirein/byterover-packages/components/button'
import { DialogFooter, DialogHeader, DialogTitle } from '@campfirein/byterover-packages/components/dialog'
import { Input } from '@campfirein/byterover-packages/components/input'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'

import type { ProviderDTO } from '../../../../../shared/transport/events'

interface BaseUrlStepProps {
  error?: string
  onBack: () => void
  onSubmit: (url: string) => void
  provider: ProviderDTO
}

export function BaseUrlStep({ error, onBack, onSubmit, provider }: BaseUrlStepProps) {
  const [url, setUrl] = useState('')

  return (
    <div className="flex flex-1 flex-col gap-6">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <button className="hover:bg-muted rounded p-0.5 transition-colors" onClick={onBack} type="button">
            <ChevronLeft className="size-5" />
          </button>
          Selecting {provider.name}
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        {error && (
          <div className="text-warning bg-warning/10 rounded-lg px-4 py-2.5 text-sm">{error}</div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-foreground text-sm font-medium" htmlFor="base-url">
            Enter endpoint manually
          </label>
          <Input
            id="base-url"
            onChange={(e) => setUrl(e.target.value)}
            placeholder="localhost:11434"
            value={url}
          />
        </div>
      </div>

      <DialogFooter className="mt-auto">
        <Button onClick={onBack} variant="secondary">
          Cancel
        </Button>
        <Button disabled={!url.trim()} onClick={() => onSubmit(url.trim())}>
          Change
        </Button>
      </DialogFooter>
    </div>
  )
}
