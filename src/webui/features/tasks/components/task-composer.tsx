import {Badge} from '@campfirein/byterover-packages/components/badge'
import {Button} from '@campfirein/byterover-packages/components/button'
import {Checkbox} from '@campfirein/byterover-packages/components/checkbox'
import {Sheet, SheetContent} from '@campfirein/byterover-packages/components/sheet'
import {Textarea} from '@campfirein/byterover-packages/components/textarea'
import {cn} from '@campfirein/byterover-packages/lib/utils'
import {type ComponentRef, type KeyboardEvent, useEffect, useRef, useState} from 'react'
import {toast} from 'sonner'

import type {TaskCreateRequest} from '../../../../shared/transport/events/task-events'

import {useTransportStore} from '../../../stores/transport-store'
import {TourStepBadge} from '../../onboarding/components/tour-step-badge'
import {useGetActiveProviderConfig} from '../../provider/api/get-active-provider-config'
import {ProviderFlowDialog} from '../../provider/components/provider-flow'
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
  initialContent?: string
  initialType?: ComposerType
  onClose: () => void
  onSubmitted?: (taskId: string, openDetail: boolean) => void
  open: boolean
  /** When set, shows a small pill in the textarea corner — used by the onboarding tour. */
  prefillNotice?: string
  /** When set, shows a "Step N of M · …" tour-context pill in the header. */
  tourStepLabel?: string
}

export function TaskComposerSheet({
  initialContent,
  initialType,
  onClose,
  onSubmitted,
  open,
  prefillNotice,
  tourStepLabel,
}: TaskComposerSheetProps) {
  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent
        className="data-[side=right]:w-full data-[side=right]:max-w-xl p-0 shadow-[inset_1px_0_0_rgba(96,165,250,0.18)]"
        side="right"
      >
        {open && (
          <ComposerForm
            initialContent={initialContent}
            initialType={initialType}
            onClose={onClose}
            onSubmitted={onSubmitted}
            prefillNotice={prefillNotice}
            tourStepLabel={tourStepLabel}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

// eslint-disable-next-line complexity
function ComposerForm({
  initialContent,
  initialType,
  onClose,
  onSubmitted,
  prefillNotice,
  tourStepLabel,
}: {
  initialContent?: string
  initialType?: ComposerType
  onClose: () => void
  onSubmitted?: (taskId: string, openDetail: boolean) => void
  prefillNotice?: string
  tourStepLabel?: string
}) {
  const projectPath = useTransportStore((s) => s.selectedProject)
  const createMutation = useCreateTask()
  const {data: activeProviderConfig} = useGetActiveProviderConfig()
  const [type, setType] = useState<ComposerType>(initialType ?? 'curate')
  const [content, setContent] = useState(initialContent ?? '')
  const [openDetailAfter, setOpenDetailAfter] = useState(false)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [hadPrefill, setHadPrefill] = useState(Boolean(initialContent))
  const textareaRef = useRef<ComponentRef<typeof Textarea>>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const canSubmit = content.trim().length > 0
  const {isPending} = createMutation
  const hasActiveProvider = Boolean(activeProviderConfig)

  const submit = async () => {
    if (!canSubmit || isPending) return

    // Action-level provider gate — without an active provider the daemon agent
    // can't run an LLM. Open the provider flow instead and let the user retry.
    if (!hasActiveProvider) {
      setProviderDialogOpen(true)
      return
    }

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

  const onTextareaKeyDown = (event: KeyboardEvent<ComponentRef<typeof Textarea>>) => {
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

  // Once the user edits the textarea, the "example" notice is no longer accurate.
  const showPrefillNotice = Boolean(prefillNotice && hadPrefill && content === (initialContent ?? ''))
  const onContentChange = (next: string) => {
    if (hadPrefill && next !== (initialContent ?? '')) setHadPrefill(false)
    setContent(next)
  }

  const inTour = Boolean(tourStepLabel)
  const submitLabel = inTour || hasActiveProvider ? (type === 'query' ? 'Query' : 'Curate') : 'Connect provider…'

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-border flex flex-col gap-2 border-b px-7 pt-5 pb-4">
          {tourStepLabel && <TourStepBadge label={tourStepLabel} />}
          <div className="flex items-center justify-between gap-4 pr-10">
            <h2 className="text-foreground flex items-baseline gap-1.5 text-lg font-medium tracking-tight">
              <span className="text-muted-foreground/70 font-normal">New</span>
              <span>{type} task</span>
            </h2>
            {!inTour && <TypeSlider onChange={setType} value={type} />}
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
                onChange={(e) => onContentChange(e.target.value)}
                onKeyDown={onTextareaKeyDown}
                placeholder={PLACEHOLDER[type]}
                ref={textareaRef}
                rows={type === 'query' ? 4 : 6}
                value={content}
              />
              {showPrefillNotice && (
                <Badge
                  className="absolute top-2.5 right-3 gap-1.5 px-2 text-[10px] tracking-[0.08em] uppercase text-primary-foreground"
                  variant="secondary"
                >
                  <span aria-hidden className="bg-primary-foreground size-1.5 rounded-full" />
                  {prefillNotice}
                </Badge>
              )}
              <span className="text-muted-foreground/40 mono pointer-events-none absolute right-3 bottom-2 text-[10px] tabular-nums">
                {content.length} chars
              </span>
            </div>
            <p className="text-muted-foreground/60 flex items-center gap-2 text-xs">
              <span>{HELP[type]}</span>
              {!content && (
                <span className="text-muted-foreground/50 ml-auto">
                  <kbd className="bg-muted text-foreground/70 mono rounded px-1.5 py-0.5 text-[10px]">Tab</kbd> to use
                  example
                </span>
              )}
            </p>
          </div>

          {type === 'curate' && !inTour && (
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
          {inTour ? (
            <span />
          ) : (
            <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={openDetailAfter} onCheckedChange={setOpenDetailAfter} />
              Open after submit
            </label>
          )}
          <div className="ml-2 flex items-center gap-2">
            <Button onClick={onClose} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button disabled={!canSubmit || isPending} onClick={submit} size="sm">
              {isPending ? `${type === 'query' ? 'Querying' : 'Curating'}…` : submitLabel}
            </Button>
          </div>
        </footer>
      </div>

      <ProviderFlowDialog onOpenChange={setProviderDialogOpen} open={providerDialogOpen} />
    </>
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
