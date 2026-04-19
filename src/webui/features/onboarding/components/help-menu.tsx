import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@campfirein/byterover-packages/components/dropdown-menu'
import {cn} from '@campfirein/byterover-packages/lib/utils'
import {BookOpen, Bug, HelpCircle, PlayCircle} from 'lucide-react'

import {useOnboardingStore} from '../stores/onboarding-store'

export function HelpMenu() {
  const seenWelcome = useOnboardingStore((s) => s.seenWelcome)
  const tourCompleted = useOnboardingStore((s) => s.tourCompleted)
  const startTour = useOnboardingStore((s) => s.startTour)

  // Show an amber dot until the user has at least dismissed the welcome OR
  // completed the tour — signals "there's a guided path here if you want it".
  const showHint = !seenWelcome || !tourCompleted

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            className="hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs transition-colors"
            type="button"
          >
            <HelpCircle className="size-4" />
            Help
            {showHint && <span aria-hidden className={cn('size-1.5 rounded-full bg-orange-500')} />}
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem className="bg-primary/8 hover:bg-primary/12 focus:bg-primary/12" onClick={() => startTour()}>
          <PlayCircle className="text-primary-foreground" />
          <span>{tourCompleted ? 'Restart the tour' : 'Take the tour'}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          render={
            <a href="https://docs.byterover.dev" rel="noopener noreferrer" target="_blank">
              <BookOpen />
              <span>Documentation</span>
            </a>
          }
        />

        <DropdownMenuItem
          render={
            <a href="https://github.com/campfirein/byterover-cli/issues" rel="noopener noreferrer" target="_blank">
              <Bug />
              <span>Report an issue</span>
            </a>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
