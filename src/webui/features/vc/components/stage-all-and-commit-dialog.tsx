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

type StageAllAndCommitDialogProps = {
  isCommitting: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function StageAllAndCommitDialog({isCommitting, onConfirm, onOpenChange, open}: StageAllAndCommitDialogProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>There are no staged changes to commit</AlertDialogTitle>
          <AlertDialogDescription>
            Would you like to stage all your changes and commit them directly?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button disabled={isCommitting} onClick={onConfirm}>
            {isCommitting ? 'Committing…' : 'Stage all & commit'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
