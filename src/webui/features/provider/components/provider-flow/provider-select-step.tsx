import {DialogHeader, DialogTitle} from '@campfirein/byterover-packages/components/dialog'
import {Input} from '@campfirein/byterover-packages/components/input'
import {Check, Search} from 'lucide-react'
import {useMemo, useState} from 'react'

import type {ProviderDTO} from '../../../../../shared/transport/events'

import {providerIcons} from './provider-icons'

interface ProviderSelectStepProps {
  onSelect: (provider: ProviderDTO) => void
  providers: ProviderDTO[]
}

export function ProviderSelectStep({onSelect, providers}: ProviderSelectStepProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search) return providers
    const q = search.toLowerCase()
    return providers.filter((p) => p.name.toLowerCase().includes(q))
  }, [providers, search])

  return (
    <div className="flex flex-1 flex-col gap-6">
      <DialogHeader>
        <DialogTitle>Choose provider</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            className="pl-9"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            value={search}
          />
        </div>

        <div className="max-h-112 overflow-y-auto">
          {filtered.map((provider) => {
            const icon = providerIcons[provider.id]

            return (
              <button
                className="hover:bg-muted flex w-full cursor-pointer items-center gap-3 rounded px-3 py-2.5 text-left transition-colors"
                key={provider.id}
                onClick={() => onSelect(provider)}
                type="button"
              >
                {icon ? (
                  <img alt="" className="size-5 shrink-0" src={icon} />
                ) : (
                  <div className="size-5 shrink-0" />
                )}
                <span className="text-foreground flex-1 text-sm">{provider.name}</span>
                {provider.isCurrent && <Check className="text-primary size-4 shrink-0" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
