import {Button} from '@campfirein/byterover-packages/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campfirein/byterover-packages/components/dialog'
import {Field, FieldDescription, FieldLabel} from '@campfirein/byterover-packages/components/field'
import {Input} from '@campfirein/byterover-packages/components/input'
import {useEffect, useId, useState} from 'react'
import {toast} from 'sonner'

import {useVcCheckout} from '../api/execute-vc-checkout'

type NewBranchDialogProps = {
  initialName?: string
  onOpenChange: (open: boolean) => void
  open: boolean
  /** When set, the new branch is created from this ref instead of current HEAD. */
  startPoint?: string
}

export function NewBranchDialog({initialName = '', onOpenChange, open, startPoint}: NewBranchDialogProps) {
  const inputId = useId()
  const [name, setName] = useState(initialName)
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const checkout = useVcCheckout()

  useEffect(() => {
    if (open) {
      setName(initialName)
      setErrorMessage(undefined)
    }
  }, [initialName, open])

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return

    setErrorMessage(undefined)
    try {
      await checkout.mutateAsync({branch: trimmed, create: true, startPoint})
      toast.success(
        startPoint ? `Created ${trimmed} from ${startPoint} and switched to it` : `Created and switched to ${trimmed}`,
        {position: 'top-center'},
      )
      onOpenChange(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create branch')
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New branch</DialogTitle>
          <DialogDescription>
            {startPoint
              ? `Create a branch based on ${startPoint} and switch to it.`
              : 'Create a branch from the current HEAD and switch to it.'}
          </DialogDescription>
        </DialogHeader>

        <Field data-invalid={Boolean(errorMessage)}>
          <FieldLabel htmlFor={inputId}>Branch name</FieldLabel>
          <Input
            aria-invalid={Boolean(errorMessage)}
            autoFocus
            id={inputId}
            onChange={(e) => {
              setName(e.target.value)
              if (errorMessage) setErrorMessage(undefined)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
            }}
            placeholder="Branch name"
            value={name}
          />
          <FieldDescription>{errorMessage}</FieldDescription>
        </Field>

        <DialogFooter>
          <DialogClose render={<Button className="cursor-pointer" variant="ghost" />}>Cancel</DialogClose>
          <Button
            className="cursor-pointer"
            disabled={name.trim().length === 0 || checkout.isPending}
            onClick={handleCreate}
          >
            {checkout.isPending ? 'Creating…' : 'Create branch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
