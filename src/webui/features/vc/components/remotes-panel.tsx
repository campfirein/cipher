import {Button} from '@campfirein/byterover-packages/components/button'
import {Field, FieldDescription, FieldError, FieldLabel} from '@campfirein/byterover-packages/components/field'
import {Input} from '@campfirein/byterover-packages/components/input'
import {Skeleton} from '@campfirein/byterover-packages/components/skeleton'
import {ExternalLink} from 'lucide-react'
import {type ComponentRef, type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState} from 'react'
import {toast} from 'sonner'

import {formatError} from '../../../lib/error-messages'
import {noop} from '../../../lib/noop'
import {useGetEnvironmentConfig} from '../../config/api/get-environment-config'
import {useGetVcRemote} from '../api/get-vc-remote'
import {useSetVcRemote} from '../api/set-vc-remote'
import {detectGitUrlType} from '../utils/detect-git-url-type'
import {validateRemoteUrl} from '../utils/validate-remote-url'
import {CalloutRow} from './callout-row'
import {InitializeVcButton} from './initialize-vc-button'
import {SettingsSection} from './settings-section'

const ORIGIN_NAME = 'origin'

function RemoteRow({onEdit, url}: {onEdit: () => void; url: string}) {
  const urlType = detectGitUrlType(url)
  const isReadOnly = urlType === 'ssh' || urlType === 'git'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-8 items-center gap-3">
        <span className="text-foreground w-14 shrink-0 text-sm font-medium">{ORIGIN_NAME}</span>
        <span className="mono text-foreground min-w-0 flex-1 truncate text-sm">{url}</span>
        <Button onClick={onEdit} size="sm" variant="ghost">
          Edit
        </Button>
      </div>
      {isReadOnly && (
        <p className="text-muted-foreground text-xs">
          Read-only from the web UI. Push and pull require an SSH agent; change to HTTPS to use them here.
        </p>
      )}
    </div>
  )
}

type EditFormProps = {
  initial: string
  isPending: boolean
  mode: 'add' | 'edit'
  onCancel: () => void
  onSubmit: (url: string) => Promise<void>
  placeholder: string
  webAppUrl?: string
}

function EditForm({initial, isPending, mode, onCancel, onSubmit, placeholder, webAppUrl}: EditFormProps) {
  const urlId = useId()
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | undefined>()
  const inputRef = useRef<ComponentRef<typeof Input>>(null)
  const dirty = value.trim() !== initial
  const validationError = validateRemoteUrl(value)
  const canSubmit = dirty && !validationError && !isPending

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      await onSubmit(value.trim())
      setError(undefined)
    } catch (error_) {
      setError(formatError(error_, 'Failed to save remote'))
    }
  }

  function fireSubmit(event: FormEvent) {
    handleSubmit(event).catch(noop)
  }

  function handleKey(event: KeyboardEvent<ComponentRef<typeof Input>>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  const showValidationError = error ?? (dirty ? validationError : undefined)
  const showReplacePreview = mode === 'edit' && !showValidationError && initial !== ''

  return (
    <form className="flex flex-col gap-4" onSubmit={fireSubmit}>
      <Field data-invalid={Boolean(showValidationError)}>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={urlId}>
            {mode === 'add' ? 'Adding ' : 'Editing '}
            <span className="mono text-foreground">{ORIGIN_NAME}</span>
          </FieldLabel>
          {mode === 'add' && webAppUrl && (
            <Button
              className="hidden sm:inline-flex"
              onClick={() => window.open(webAppUrl, '_blank', 'noopener,noreferrer')}
              size="sm"
              type="button"
              variant="ghost"
            >
              <ExternalLink className="size-3.5" />
              Find in ByteRover
            </Button>
          )}
        </div>
        <Input
          aria-invalid={Boolean(showValidationError)}
          className="mono"
          disabled={isPending}
          id={urlId}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(undefined)
          }}
          onKeyDown={handleKey}
          placeholder={placeholder}
          ref={inputRef}
          value={value}
        />
        {showValidationError && <FieldError>{showValidationError}</FieldError>}
        {!showValidationError && mode === 'add' && (
          <FieldDescription>Only HTTPS URLs are supported right now.</FieldDescription>
        )}
        {showReplacePreview && (
          <FieldDescription>
            Replaces current URL <span className="mono text-foreground">{initial}</span>
          </FieldDescription>
        )}
      </Field>

      <div className="flex items-center justify-end gap-2">
        <Button disabled={isPending} onClick={onCancel} type="button" variant="secondary">
          Cancel
        </Button>
        <Button disabled={!canSubmit} type="submit">
          {isPending ? 'Saving…' : mode === 'add' ? 'Add remote' : 'Replace URL'}
        </Button>
      </div>
    </form>
  )
}

export function RemotesPanel() {
  const {data, error, isError, refetch} = useGetVcRemote()
  const {data: envConfig} = useGetEnvironmentConfig()
  const setRemote = useSetVcRemote()
  const [editing, setEditing] = useState(false)

  const url = data?.url
  const gitInitialized = data?.gitInitialized
  const hasRemote = Boolean(url)
  const showAddAction = gitInitialized === true && !hasRemote && !editing
  const urlPlaceholder = `${envConfig?.gitRemoteBaseUrl ?? 'https://example.com'}/team/space.git`

  async function submit(next: string) {
    await setRemote.mutateAsync({subcommand: hasRemote ? 'set-url' : 'add', url: next})
    toast.success(hasRemote ? 'Origin replaced.' : 'Remote added.')
    setEditing(false)
  }

  return (
    <SettingsSection
      action={
        showAddAction && (
          <Button onClick={() => setEditing(true)} size="sm" variant="outline">
            Add remote
          </Button>
        )
      }
      compact={!editing}
      description="Used for push, pull, and fetch."
      error={isError ? error : undefined}
      errorFallback="Failed to load remote"
      onRetry={() => refetch().catch(noop)}
      title="Remotes"
    >
      {data ? (
        gitInitialized === false ? (
          <CalloutRow
            action={<InitializeVcButton />}
            description="Initialize version control before adding a remote."
            title="Not initialized"
          />
        ) : editing ? (
          <EditForm
            initial={url ?? ''}
            isPending={setRemote.isPending}
            mode={hasRemote ? 'edit' : 'add'}
            onCancel={() => setEditing(false)}
            onSubmit={submit}
            placeholder={urlPlaceholder}
            webAppUrl={envConfig?.webAppUrl}
          />
        ) : url ? (
          <RemoteRow onEdit={() => setEditing(true)} url={url} />
        ) : (
          <p className="text-muted-foreground text-sm">
            No remote set. Push and pull need an{' '}
            <code className="mono bg-muted text-foreground rounded px-1 py-0.5 text-xs">origin</code> URL.
          </p>
        )
      ) : (
        <div className="flex min-h-8 items-center gap-3">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-8 w-12" />
        </div>
      )}
    </SettingsSection>
  )
}
