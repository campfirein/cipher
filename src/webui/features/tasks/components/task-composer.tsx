import {Sheet, SheetContent} from '@campfirein/byterover-packages/components/sheet'
import {Textarea} from '@campfirein/byterover-packages/components/textarea'
import {cn} from '@campfirein/byterover-packages/lib/utils'
import {Command} from 'lucide-react'
import {type ComponentRef, type KeyboardEvent, useEffect, useRef, useState} from 'react'

import {useTransportStore} from '../../../stores/transport-store'
import {useGetActiveProviderConfig} from '../../provider/api/get-active-provider-config'
import {ProviderFlowDialog} from '../../provider/components/provider-flow'
import {useComposerSubmit} from '../hooks/use-composer-submit'
import {CurateAttachmentHint, HelpRow, PrefillBadge} from './task-composer-bits'
import {ComposerFooter} from './task-composer-footer'
import {ComposerHeader} from './task-composer-header'
import {type ComposerType, PLACEHOLDER} from './task-composer-types'

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
  // Tour mode keeps the dim/blur backdrop because the composer is the focal
  // point of the step. Outside the tour, drop the overlay so the rest of the
  // app stays sharp behind the side sheet.
  const inTour = Boolean(tourStepLabel)
  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent
        className={cn(
          'data-[side=right]:w-full data-[side=right]:max-w-xl p-0 shadow-[inset_1px_0_0_rgba(96,165,250,0.18)]',
          !inTour && 'sheet-no-overlay',
        )}
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
  const {data: activeProviderConfig} = useGetActiveProviderConfig()
  const [type, setType] = useState<ComposerType>(initialType ?? 'curate')
  const [content, setContent] = useState(initialContent ?? '')
  const [openDetailAfter, setOpenDetailAfter] = useState(true)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [hadPrefill, setHadPrefill] = useState(Boolean(initialContent))
  const textareaRef = useRef<ComponentRef<typeof Textarea>>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const hasActiveProvider = Boolean(activeProviderConfig)
  const inTour = Boolean(tourStepLabel)

  const {canSubmit, isPending, submit} = useComposerSubmit({
    content,
    hasActiveProvider,
    onClose,
    onProviderRequired: () => setProviderDialogOpen(true),
    onSubmitted,
    openDetailAfter,
    projectPath,
    type,
  })

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

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <ComposerHeader
          inTour={inTour}
          onTypeChange={setType}
          projectPath={projectPath}
          tourStepLabel={tourStepLabel}
          type={type}
        />

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
              {showPrefillNotice && prefillNotice && <PrefillBadge label={prefillNotice} />}
              <span className="text-muted-foreground/40 mono pointer-events-none absolute right-3 bottom-2 flex items-center gap-2 text-[10px] tabular-nums">
                <span className="text-muted-foreground/60">
                  {content ? (
                    <>
                      <kbd className="bg-muted text-foreground/70 inline-flex items-center gap-1 rounded px-1.5 py-0.5 leading-none">
                        <Command className="size-2.5" />/ Ctrl + Enter
                      </kbd>{' '}
                      to {type}
                    </>
                  ) : (
                    <>
                      <kbd className="bg-muted text-foreground/70 inline-flex items-center rounded px-1.5 py-0.5 leading-none">
                        Tab
                      </kbd>{' '}
                      to use example
                    </>
                  )}
                </span>
                <span>{content.length} chars</span>
              </span>
            </div>
            <HelpRow type={type} />
          </div>

          {type === 'curate' && !inTour && <CurateAttachmentHint />}
        </div>

        <ComposerFooter
          canSubmit={canSubmit}
          hasActiveProvider={hasActiveProvider}
          inTour={inTour}
          isPending={isPending}
          onClose={onClose}
          onOpenDetailChange={setOpenDetailAfter}
          onSubmit={submit}
          openDetailAfter={openDetailAfter}
          type={type}
        />
      </div>

      <ProviderFlowDialog onOpenChange={setProviderDialogOpen} open={providerDialogOpen} />
    </>
  )
}
