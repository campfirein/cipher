import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campfirein/byterover-packages/components/alert-dialog'
import {Button} from '@campfirein/byterover-packages/components/button'
import {toast} from 'sonner'

import {useVcBranchDelete} from '../api/execute-vc-branch-delete'

type DeleteBranchDialogProps = {
  branchName: string
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function DeleteBranchDialog({branchName, onOpenChange, open}: DeleteBranchDialogProps) {
  const del = useVcBranchDelete()

  async function handleDelete() {
    try {
      await del.mutateAsync(branchName)

      toast.success(`Deleted ${branchName}`, {position: 'top-center'})
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete branch', {
        position: 'top-center',
      })
    }
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete branch?</AlertDialogTitle>
          <AlertDialogDescription>
            Branch <code className="rounded bg-muted px-1.5 py-0.5 text-sm">{branchName}</code> will be removed.
            Unmerged commits on this branch will be lost unless they are reachable from another ref.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button disabled={del.isPending} onClick={handleDelete} variant="destructive">
            {del.isPending ? 'Deleting…' : 'Delete branch'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
