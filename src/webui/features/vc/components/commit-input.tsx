import type { KeyboardEvent } from 'react'

import { Button } from '@campfirein/byterover-packages/components/button'
import { Textarea } from '@campfirein/byterover-packages/components/textarea'

interface CommitInputProps {
  canCommit: boolean
  isCommitting: boolean
  message: string
  onCommit: () => void
  onMessageChange: (message: string) => void
}

export function CommitInput({ canCommit, isCommitting, message, onCommit, onMessageChange }: CommitInputProps) {
  // eslint-disable-next-line no-undef
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter to commit (VS Code convention)
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onCommit()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        className="min-h-20 resize-none"
        onChange={(e) => onMessageChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message (Cmd/Ctrl+Enter to commit)"
        value={message}
      />
      <Button
        className="w-full gap-2"
        disabled={!canCommit || !message.trim() || isCommitting}
        onClick={onCommit}
        size="sm"
      >
        Commit
      </Button>
    </div>
  )
}
