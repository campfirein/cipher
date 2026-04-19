import {DialogDescription, DialogHeader, DialogTitle} from '@campfirein/byterover-packages/components/dialog'
import {Input} from '@campfirein/byterover-packages/components/input'
import {cn} from '@campfirein/byterover-packages/lib/utils'
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
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Pick a provider to power curate &amp; query</DialogTitle>
        <DialogDescription>
          ByteRover routes LLM calls through your chosen provider. You can change this later in Configuration.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input className="pl-9" onChange={(e) => setSearch(e.target.value)} placeholder="Search..." value={search} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-4 -mr-4 [scrollbar-gutter:stable]">
          {filtered.map((provider) => {
            const icon = providerIcons[provider.id]
            const isActive = provider.isCurrent

            return (
              <button
                className={cn(
                  'group/row flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  isActive ? 'border-primary-foreground/40 bg-primary/5' : 'border-border hover:border-foreground/25',
                )}
                key={provider.id}
                onClick={() => onSelect(provider)}
                type="button"
              >
                <div className="bg-muted/50 grid size-7 shrink-0 place-items-center overflow-hidden rounded-md">
                  {icon && <img alt="" className="size-5" src={icon} />}
                </div>
                <span className="text-foreground flex-1 text-sm font-medium">{provider.name}</span>
                <div
                  className={cn(
                    'grid size-[18px] shrink-0 place-items-center rounded-full border transition-colors',
                    isActive ? 'bg-primary-foreground border-primary-foreground' : 'border-border',
                  )}
                >
                  {isActive && <Check className="text-background size-3" strokeWidth={3} />}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
