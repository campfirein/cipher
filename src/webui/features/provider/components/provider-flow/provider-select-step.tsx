import {Badge} from '@campfirein/byterover-packages/components/badge'
import {DialogDescription, DialogHeader, DialogTitle} from '@campfirein/byterover-packages/components/dialog'
import {Input} from '@campfirein/byterover-packages/components/input'
import {cn} from '@campfirein/byterover-packages/lib/utils'
import {Check, Search} from 'lucide-react'
import {useMemo, useState} from 'react'

import type {ProviderDTO} from '../../../../../shared/transport/events'

import {providerIcons} from './provider-icons'

const BYTEROVER_PROVIDER_ID = 'byterover'

interface ProviderSelectStepProps {
  onSelect: (provider: ProviderDTO) => void
  providers: ProviderDTO[]
}

/**
 * Sort ByteRover to the top so it shows as the default choice. Everything else
 * keeps its server-side ordering.
 */
function orderProviders(providers: ProviderDTO[]): ProviderDTO[] {
  const byterover = providers.find((p) => p.id === BYTEROVER_PROVIDER_ID)
  if (!byterover) return providers
  return [byterover, ...providers.filter((p) => p.id !== BYTEROVER_PROVIDER_ID)]
}

export function ProviderSelectStep({onSelect, providers}: ProviderSelectStepProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const ordered = orderProviders(providers)
    if (!search) return ordered
    const q = search.toLowerCase()
    return ordered.filter((p) => p.name.toLowerCase().includes(q))
  }, [providers, search])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Pick a provider to power curate &amp; query</DialogTitle>
        <DialogDescription>
          ByteRover routes LLM calls through your chosen provider. You can change this later.
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
            const isByteRover = provider.id === BYTEROVER_PROVIDER_ID

            return (
              <button
                className={cn(
                  'group/row flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  isActive ? 'border-primary-foreground/40 bg-primary/5' : 'border-border hover:border-foreground/25',
                )}
                key={provider.id}
                onClick={() => onSelect(provider)}
                title={provider.description}
                type="button"
              >
                <div className="bg-muted/50 grid size-7 shrink-0 place-items-center overflow-hidden rounded-md">
                  {icon && <img alt="" className="size-5" src={icon} />}
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="text-foreground flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="font-medium truncate">{provider.name}</span>
                    {isByteRover && (
                      <Badge
                        className="border-amber-500/50 bg-amber-500/15 text-amber-400 h-[18px] rounded-sm px-1.5 text-[11px] font-medium leading-none"
                        variant="outline"
                      >
                        Native
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground min-h-lh truncate text-xs">{provider.description}</div>
                </div>
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
