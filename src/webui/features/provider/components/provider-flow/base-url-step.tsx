import {Button} from '@campfirein/byterover-packages/components/button'
import {DialogFooter, DialogHeader, DialogTitle} from '@campfirein/byterover-packages/components/dialog'
import {Input} from '@campfirein/byterover-packages/components/input'
import {ChevronLeft} from 'lucide-react'
import {useCallback, useState} from 'react'

import type {ProviderDTO} from '../../../../../shared/transport/events'

function validateUrl(input: string): string | undefined {
  if (!input) {
    return 'Base URL is required'
  }

  try {
    const parsed = new URL(input)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'URL must start with http:// or https://'
    }

    return undefined
  } catch {
    return 'Invalid URL format'
  }
}

interface BaseUrlStepProps {
  error?: string
  onBack: () => void
  onSubmit: (url: string) => void
  provider: ProviderDTO
}

export function BaseUrlStep({error: externalError, onBack, onSubmit, provider}: BaseUrlStepProps) {
  const [url, setUrl] = useState('')
  const [validationError, setValidationError] = useState<string | undefined>()

  const displayError = validationError ?? externalError

  const handleSubmit = useCallback(() => {
    const trimmed = url.trim().replace(/\/+$/, '')
    const err = validateUrl(trimmed)
    if (err) {
      setValidationError(err)
      return
    }

    setValidationError(undefined)
    onSubmit(trimmed)
  }, [url, onSubmit])

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

      <div className="flex flex-col gap-2">
        <label className="text-foreground text-sm font-medium" htmlFor="base-url">
          Enter endpoint manually
        </label>
        <Input
          id="base-url"
          onChange={(e) => {
            setUrl(e.target.value)
            setValidationError(undefined)
          }}
          placeholder="http://localhost:11434/v1"
          value={url}
        />
        {displayError && (
          <p className="text-destructive text-sm">{displayError}</p>
        )}
      </div>

      <DialogFooter className="mt-auto">
        <Button onClick={onBack} variant="secondary">
          Cancel
        </Button>
        <Button disabled={!url.trim()} onClick={handleSubmit}>
          Change
        </Button>
      </DialogFooter>
    </div>
  )
}
