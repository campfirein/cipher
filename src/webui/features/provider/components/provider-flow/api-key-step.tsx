import { Button } from '@campfirein/byterover-packages/components/button'
import { DialogFooter, DialogHeader, DialogTitle } from '@campfirein/byterover-packages/components/dialog'
import { Input } from '@campfirein/byterover-packages/components/input'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'

import type { ProviderDTO } from '../../../../../shared/transport/events'

interface ApiKeyStepProps {
  error?: string
  isOptional?: boolean
  isValidating?: boolean
  onBack: () => void
  onSubmit: (apiKey: string) => void
  provider: ProviderDTO
}

export function ApiKeyStep({ error, isOptional, isValidating, onBack, onSubmit, provider }: ApiKeyStepProps) {
  const [apiKey, setApiKey] = useState('')

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
        {provider.apiKeyUrl && (
          <p className="text-muted-foreground text-sm">
            Get your API key at{' '}
            <a className="underline hover:text-foreground" href={provider.apiKeyUrl} rel="noopener noreferrer" target="_blank">
              {provider.apiKeyUrl}
            </a>
          </p>
        )}

        {error && (
          <div className="text-destructive bg-destructive/10 rounded-lg px-4 py-2.5 text-sm">{error}</div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-foreground text-sm font-medium" htmlFor="api-key">
            Enter your {provider.name} API key
          </label>
          <Input
            id="api-key"
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter key"
            type="password"
            value={apiKey}
          />
        </div>
      </div>

      <DialogFooter className="mt-auto">
        <Button onClick={onBack} variant="secondary">
          Cancel
        </Button>
        <Button
          disabled={(!isOptional && !apiKey.trim()) || isValidating}
          onClick={() => onSubmit(apiKey.trim())}
        >
          {isValidating ? 'Validating...' : 'Change'}
        </Button>
      </DialogFooter>
    </div>
  )
}
