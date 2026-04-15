import { Button } from '@campfirein/byterover-packages/components/button'
import { DialogClose, DialogFooter, DialogHeader, DialogTitle } from '@campfirein/byterover-packages/components/dialog'
import { Input } from '@campfirein/byterover-packages/components/input'
import { Check, LoaderCircle, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { ModelDTO } from '../../../../../shared/transport/events'

import { useGetModels } from '../../../model/api/get-models'

interface ModelSelectStepProps {
  onCancel: () => void
  onSelect: (model: ModelDTO) => void
  providerId: string
}

export function ModelSelectStep({ onCancel: _onCancel, onSelect, providerId }: ModelSelectStepProps) {
  const [search, setSearch] = useState('')
  const {data, isLoading} = useGetModels({providerId})
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>()

  const models = useMemo(() => data?.models ?? [], [data?.models])

  // Sync active model from server once data loads
  useEffect(() => {
    if (data?.activeModel && !selectedModelId) {
      setSelectedModelId(data.activeModel)
    }
  }, [data?.activeModel, selectedModelId])

  const filtered = useMemo(() => {
    if (!search) return models
    const q = search.toLowerCase()
    return models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
  }, [models, search])

  const selectedModel = models.find((m) => m.id === selectedModelId)

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <DialogHeader>
          <DialogTitle>Choose model</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center py-12">
          <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <DialogHeader>
        <DialogTitle>Choose model</DialogTitle>
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

        <div className="max-h-96 overflow-y-auto">
          {filtered.map((model) => {
            const isSelected = model.id === selectedModelId

            return (
              <button
                className={`border-border flex w-full cursor-pointer items-center justify-between border-b px-3 py-2.5 text-left transition-colors last:border-b-0 ${isSelected ? 'bg-primary/10' : 'hover:bg-muted'
                  }`}
                key={model.id}
                onClick={() => setSelectedModelId(model.id)}
                type="button"
              >
                <span className="text-foreground text-sm">{model.name}</span>
                {isSelected && <Check className="text-primary size-4" />}
              </button>
            )
          })}

          {filtered.length === 0 && (
            <p className="text-muted-foreground py-8 text-center text-sm">No models found</p>
          )}
        </div>
      </div>

      <DialogFooter className="mt-auto">
        <DialogClose render={<Button variant="secondary" />}>
          Cancel
        </DialogClose>
        <Button
          disabled={!selectedModel}
          onClick={() => selectedModel && onSelect(selectedModel)}
        >
          Confirm
        </Button>
      </DialogFooter>
    </div>
  )
}
