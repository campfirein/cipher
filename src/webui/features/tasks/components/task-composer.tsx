import {Button} from '@campfirein/byterover-packages/components/button'
import {Checkbox} from '@campfirein/byterover-packages/components/checkbox'
import {Sheet, SheetContent} from '@campfirein/byterover-packages/components/sheet'
import {Textarea} from '@campfirein/byterover-packages/components/textarea'
import {cn} from '@campfirein/byterover-packages/lib/utils'
import {type KeyboardEvent, useEffect, useRef, useState} from 'react'
import {toast} from 'sonner'

import type {TaskCreateRequest} from '../../../../shared/transport/events/task-events'

import {useTransportStore} from '../../../stores/transport-store'
import {useCreateTask} from '../api/create-task'

type ComposerType = 'curate' | 'query'

const PLACEHOLDER: Record<ComposerType, string> = {
  curate:
    'JWT tokens expire after 24h. Refresh window is 7 days. Rotation happens on every successful refresh — old refresh token is invalidated immediately.',
  query: 'What is our auth token expiration policy?',
}

const HELP: Record<ComposerType, string> = {
  curate: 'Plain text knowledge to capture into the project context tree.',
  query: 'The agent searches the project context tree and synthesizes an answer.',
}

interface TaskComposerSheetProps {
  onClose: () => void
  onSubmitted?: (taskId: string, openDetail: boolean) => void
  open: boolean
}

export function TaskComposerSheet({onClose, onSubmitted, open}: TaskComposerSheetProps) {
  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:max-w-xl p-0 shadow-[inset_1px_0_0_rgba(96,165,250,0.18)]" side="right">
        {open && <ComposerForm onClose={onClose} onSubmitted={onSubmitted} />}
      </SheetContent>
    </Sheet>
  )
}

function ComposerForm({
  onClose,
  onSubmitted,
}: {
  onClose: () => void
  onSubmitted?: (taskId: string, openDetail: boolean) => void
}) {
  const projectPath = useTransportStore((s) => s.selectedProject)
  const createMutation = useCreateTask()
  const [type, setType] = useState<ComposerType>('curate')
  const [content, setContent] = useState('')
  const [openDetailAfter, setOpenDetailAfter] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const canSubmit = content.trim().length > 0
  const {isPending} = createMutation

  const submit = async () => {
    if (!canSubmit || isPending) return
    const taskId = crypto.randomUUID()
    const payload: TaskCreateRequest = {
      ...(projectPath ? {clientCwd: projectPath, projectPath} : {}),
      content: content.trim(),
      taskId,
      type,
    }

    try {
      await createMutation.mutateAsync(payload)
      toast.success(`${type === 'query' ? 'Query' : 'Curate'} task queued`, {position: 'top-center'})
      onSubmitted?.(taskId, openDetailAfter)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create task', {
        position: 'top-center',
      })
    }
  }

  const onTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      submit().catch(() => {})
      return
    }

    if (event.key === 'Tab' && !event.shiftKey && !content) {
      event.preventDefault()
      setContent(PLACEHOLDER[type])
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border flex flex-col gap-2 border-b px-7 pt-5 pb-4">
        <div className="flex items-center justify-between gap-4 pr-10">
          <h2 className="text-foreground flex items-baseline gap-1.5 text-lg font-medium tracking-tight">
            <span className="text-muted-foreground/70 font-normal">New</span>
            <span>{type} task</span>
          </h2>
          <TypeSlider onChange={setType} value={type} />
        </div>
        <p className="text-muted-foreground/70 text-xs">
          {type === 'query' ? 'Searches' : 'Will dispatch to'}{' '}
          <span className="text-identifier mono">{projectPath || '(no project selected)'}</span>
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-5">
        <div className="space-y-1.5">
          <div className="relative">
            <Textarea
              className="bg-card dark:bg-card text-foreground/90 mono min-h-64 pr-4 pb-7 text-sm leading-relaxed"
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={onTextareaKeyDown}
              placeholder={PLACEHOLDER[type]}
              ref={textareaRef}
              rows={type === 'query' ? 4 : 6}
              value={content}
            />
            <span className="text-muted-foreground/40 mono pointer-events-none absolute right-3 bottom-2 text-[10px] tabular-nums">
              {content.length} chars
            </span>
          </div>
          <p className="text-muted-foreground/60 flex items-center gap-2 text-xs">
            <span>{HELP[type]}</span>
            {!content && (
              <span className="text-muted-foreground/50 ml-auto">
                <kbd className="bg-muted text-foreground/70 mono rounded px-1.5 py-0.5 text-[10px]">Tab</kbd> to use example
              </span>
            )}
          </p>
        </div>

        {type === 'curate' && (
          <p className="text-muted-foreground/60 mt-2 text-xs">
            For file or folder attachments, use{' '}
            <code className="bg-muted text-foreground/80 mono rounded px-1.5 py-0.5 text-[11px]">
              brv curate -f &lt;path&gt;
            </code>{' '}
            from the CLI.
          </p>
        )}
      </div>

      <footer className="border-border flex items-center justify-between gap-3 border-t px-7 py-3.5">
        <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox checked={openDetailAfter} onCheckedChange={setOpenDetailAfter} />
          Open after submit
        </label>
        <div className="ml-2 flex items-center gap-2">
          <Button onClick={onClose} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button disabled={!canSubmit || isPending} onClick={submit} size="sm">
            {isPending ? `${type === 'query' ? 'Querying' : 'Curating'}…` : type === 'query' ? 'Query' : 'Curate'}
          </Button>
        </div>
      </footer>
    </div>
  )
}

function TypeSlider({onChange, value}: {onChange: (next: ComposerType) => void; value: ComposerType}) {
  return (
    <div className="border-border bg-muted relative inline-flex rounded-md border p-0.5">
      <span
        aria-hidden
        className={cn(
          'bg-background border-border absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded border transition-transform duration-200 ease-out',
          value === 'query' ? 'translate-x-full' : 'translate-x-0',
        )}
      />
      {(['curate', 'query'] as const).map((option) => (
        <button
          className={cn(
            'relative z-10 px-3 py-1 text-xs font-medium transition-colors',
            option === value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80',
          )}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {option === 'curate' ? 'Curate' : 'Query'}
        </button>
      ))}
    </div>
  )
}
