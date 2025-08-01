import * as React from "react"
import { Plus, X } from "lucide-react"
import { Input } from "./input"
import { Button } from "./button"
import { generateId } from "@/lib/utils"

export interface KeyValuePair {
  key: string
  value: string
  id: string
}

export interface KeyValueEditorProps {
  pairs: KeyValuePair[]
  onChange: (pairs: KeyValuePair[]) => void
  placeholder?: {
    key?: string
    value?: string
  }
  className?: string
}

const createEmptyPair = (): KeyValuePair => ({
  key: '',
  value: '',
  id: generateId()
})

export const KeyValueEditor = React.forwardRef<
  HTMLDivElement,
  KeyValueEditorProps
>(({ pairs, onChange, placeholder, className, ...props }, ref) => {
  React.useEffect(() => {
    if (pairs.length === 0) {
      onChange([createEmptyPair()])
    }
  }, [pairs.length, onChange])

  const addPair = () => {
    onChange([...pairs, createEmptyPair()])
  }

  const removePair = (id: string) => {
    const filtered = pairs.filter(p => p.id !== id)
    onChange(filtered.length === 0 ? [createEmptyPair()] : filtered)
  }

  const updatePair = (id: string, field: keyof KeyValuePair, value: string) => {
    onChange(pairs.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  return (
    <div ref={ref} className={className} {...props}>
      <div className="space-y-3">
        <div className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-5 text-sm font-medium text-muted-foreground">
            Key
          </div>
          <div className="col-span-6 text-sm font-medium text-muted-foreground">
            Value
          </div>
          <div className="col-span-1"></div>
        </div>
        
        {pairs.map((pair) => (
          <div key={pair.id} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-5">
              <Input
                value={pair.key}
                onChange={(e) => updatePair(pair.id, 'key', e.target.value)}
                placeholder={placeholder?.key || "Key"}
              />
            </div>
            <div className="col-span-6">
              <Input
                value={pair.value}
                onChange={(e) => updatePair(pair.id, 'value', e.target.value)}
                placeholder={placeholder?.value || "Value"}
              />
            </div>
            <div className="col-span-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removePair(pair.id)}
                className="h-9 w-9"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Remove pair</span>
              </Button>
            </div>
          </div>
        ))}
        
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addPair}
          className="w-full"
        >
          <Plus className="h-4 w-4" />
          Add Pair
        </Button>
      </div>
    </div>
  )
})

KeyValueEditor.displayName = "KeyValueEditor"