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
import {Input} from '@campfirein/byterover-packages/components/input'
import {useEffect, useState} from 'react'
import {toast} from 'sonner'

import {useVcCheckout} from '../api/execute-vc-checkout'

type CheckoutRefDialogProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function CheckoutRefDialog({onOpenChange, open}: CheckoutRefDialogProps) {
  const [ref, setRef] = useState('')
  const checkout = useVcCheckout()

  useEffect(() => {
    if (open) setRef('')
  }, [open])

  async function handleCheckout() {
    const trimmed = ref.trim()
    if (!trimmed) return

    try {
      await checkout.mutateAsync({branch: trimmed})
      toast.success(`Checked out ${trimmed}`, {position: 'top-center'})
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to checkout ref', {
        position: 'top-center',
      })
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Checkout tag or revision</DialogTitle>
          <DialogDescription>
            Enter a branch name, tag, or commit SHA. Non-branch refs will put you in a detached HEAD.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCheckout()
          }}
          placeholder="Tag, branch, or commit SHA"
          value={ref}
        />

        <DialogFooter>
          <DialogClose render={<Button className="cursor-pointer" variant="ghost" />}>Cancel</DialogClose>
          <Button
            className="cursor-pointer"
            disabled={ref.trim().length === 0 || checkout.isPending}
            onClick={handleCheckout}
          >
            {checkout.isPending ? 'Checking out…' : 'Checkout'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
