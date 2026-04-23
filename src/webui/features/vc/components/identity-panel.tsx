import {Button} from '@campfirein/byterover-packages/components/button'
import {Field, FieldError, FieldLabel} from '@campfirein/byterover-packages/components/field'
import {Input} from '@campfirein/byterover-packages/components/input'
import {Skeleton} from '@campfirein/byterover-packages/components/skeleton'
import {LoaderCircle} from 'lucide-react'
import {type FormEvent, useId, useState} from 'react'
import {toast} from 'sonner'

import type {UserDTO} from '../../../../shared/transport/types/dto'

import {formatError} from '../../../lib/error-messages'
import {noop} from '../../../lib/noop'
import {useAuthStore} from '../../auth/stores/auth-store'
import {useGetVcConfig} from '../api/get-vc-config'
import {useSetVcConfig} from '../api/set-vc-config'
import {isValidEmail} from '../utils/is-valid-email'
import {CalloutRow} from './callout-row'
import {SettingsSection} from './settings-section'

type IdentityValues = {
  email: string
  name: string
}

function NotSetCallout({
  isPending,
  onApplyAccount,
  onSetManually,
  user,
}: {
  isPending: boolean
  onApplyAccount: () => void
  onSetManually: () => void
  user: null | UserDTO
}) {
  return (
    <CalloutRow
      action={
        <div className="flex gap-1.5">
          <Button
            disabled={isPending}
            onClick={onSetManually}
            size="sm"
            variant={user ? 'ghost' : 'secondary'}
          >
            Set manually
          </Button>
          {user && (
            <Button disabled={isPending} onClick={onApplyAccount} size="sm">
              Use account
            </Button>
          )}
        </div>
      }
      description={
        user ? (
          <>
            Apply <span className="text-foreground">{user.name ?? user.email}</span> &lt;{user.email}&gt; or configure
            manually.
          </>
        ) : (
          'Name and email are required to commit.'
        )
      }
      title="Not set"
    />
  )
}

function CompactRow({email, name, onEdit}: {email: string; name: string; onEdit: () => void}) {
  return (
    <div className="flex min-h-8 items-center gap-3">
      <span className="text-foreground min-w-0 flex-1 truncate text-sm">
        {name} <span className="text-muted-foreground mono">&lt;{email}&gt;</span>
      </span>
      <Button onClick={onEdit} size="sm" variant="ghost">
        Edit
      </Button>
    </div>
  )
}

type EditFormProps = {
  initial: IdentityValues
  isPending: boolean
  onCancel: () => void
  onSubmit: (values: IdentityValues) => Promise<void>
}

function EditForm({initial, isPending, onCancel, onSubmit}: EditFormProps) {
  const nameId = useId()
  const emailId = useId()
  const [name, setName] = useState(initial.name)
  const [email, setEmail] = useState(initial.email)

  const trimmedName = name.trim()
  const trimmedEmail = email.trim()
  const dirty = trimmedName !== initial.name || trimmedEmail !== initial.email
  const complete = trimmedName.length > 0 && trimmedEmail.length > 0
  const emailInvalid = trimmedEmail.length > 0 && !isValidEmail(trimmedEmail)
  // Only surface the error once the user has interacted (dirty) — don't shout
  // on an initially-empty form.
  const showEmailError = emailInvalid && dirty
  const canSubmit = dirty && complete && !emailInvalid && !isPending

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    await onSubmit({email: trimmedEmail, name: trimmedName})
  }

  function fireSubmit(event: FormEvent) {
    handleSubmit(event).catch(noop)
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={fireSubmit}>
      <Field>
        <FieldLabel htmlFor={nameId}>Name</FieldLabel>
        <Input
          disabled={isPending}
          id={nameId}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          value={name}
        />
      </Field>

      <Field data-invalid={showEmailError}>
        <FieldLabel htmlFor={emailId}>Email</FieldLabel>
        <Input
          aria-invalid={showEmailError}
          disabled={isPending}
          id={emailId}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          type="email"
          value={email}
        />
        {showEmailError && <FieldError>Enter a valid email address.</FieldError>}
      </Field>

      <div className="flex items-center justify-end gap-2">
        <Button disabled={isPending} onClick={onCancel} type="button" variant="secondary">
          Cancel
        </Button>
        <Button disabled={!canSubmit} type="submit">
          {isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

export function IdentityPanel() {
  const {data: config, error, isError, isLoading, refetch} = useGetVcConfig()
  const setConfig = useSetVcConfig()
  const user = useAuthStore((s) => s.user)
  const [editing, setEditing] = useState(false)

  const storedName = config?.name ?? ''
  const storedEmail = config?.email ?? ''
  const configured = Boolean(storedName && storedEmail)

  async function save(values: IdentityValues) {
    try {
      // Serial — the daemon's config write is read-merge-write per field,
      // so concurrent writes race and clobber each other.
      if (values.name && values.name !== storedName) {
        await setConfig.mutateAsync({key: 'user.name', value: values.name})
      }

      if (values.email && values.email !== storedEmail) {
        await setConfig.mutateAsync({key: 'user.email', value: values.email})
      }

      toast.success('Git identity saved.')
      setEditing(false)
    } catch (error_) {
      toast.error(formatError(error_, 'Failed to save identity.'))
      throw error_
    }
  }

  async function applyFromAccount() {
    if (!user) return
    try {
      await setConfig.mutateAsync({key: 'user.name', value: user.name ?? user.email})
      await setConfig.mutateAsync({key: 'user.email', value: user.email})
      toast.success('Git identity applied from your ByteRover account.')
    } catch (error_) {
      toast.error(formatError(error_, 'Failed to apply identity.'))
    }
  }

  return (
    <SettingsSection
      action={isLoading ? <LoaderCircle className="text-muted-foreground mt-1 size-4 animate-spin" /> : undefined}
      compact={!editing}
      description="Recorded on every commit in this project."
      error={isError ? error : undefined}
      errorFallback="Failed to load identity"
      onRetry={() => refetch().catch(noop)}
      title="Git identity"
    >
      {config ? (
        editing ? (
          <EditForm
            initial={{email: storedEmail, name: storedName}}
            isPending={setConfig.isPending}
            onCancel={() => setEditing(false)}
            onSubmit={save}
          />
        ) : configured ? (
          <CompactRow email={storedEmail} name={storedName} onEdit={() => setEditing(true)} />
        ) : (
          <NotSetCallout
            isPending={setConfig.isPending}
            onApplyAccount={() => applyFromAccount().catch(noop)}
            onSetManually={() => setEditing(true)}
            user={user}
          />
        )
      ) : (
        <div className="flex min-h-8 items-center gap-3">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-8 w-12" />
        </div>
      )}
    </SettingsSection>
  )
}
