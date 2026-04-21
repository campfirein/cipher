import {Button} from '@campfirein/byterover-packages/components/button'
import {Dialog, DialogContent} from '@campfirein/byterover-packages/components/dialog'
import {ArrowRight, Plug} from 'lucide-react'
import {useNavigate} from 'react-router-dom'

import {useOnboardingStore} from '../stores/onboarding-store'
import {TourStepBadge} from './tour-step-badge'

export function ConnectorStep() {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const tourStep = useOnboardingStore((s) => s.tourStep)
  const advanceTour = useOnboardingStore((s) => s.advanceTour)
  const exitTour = useOnboardingStore((s) => s.exitTour)
  const navigate = useNavigate()

  const open = tourActive && tourStep === 'connector'

  const handleOpenConfig = () => {
    advanceTour()
    navigate('/configuration')
  }

  return (
    <Dialog onOpenChange={(next) => !next && exitTour()} open={open}>
      <DialogContent className="flex flex-col gap-5 p-6 sm:max-w-[460px]">
        <TourStepBadge label="Step 4 of 4 · Optional" />

        <div className="flex flex-col gap-3">
          <div className="bg-primary/12 text-primary-foreground grid size-10 place-items-center rounded-lg">
            <Plug className="size-5" />
          </div>
          <h2 className="text-foreground text-base font-semibold">Use ByteRover from your AI agent</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Connect a tool like Claude Code, Cursor, or any MCP client and you can curate &amp; query the context tree
            without leaving your chat. It's optional — you can always come back via the{' '}
            <span className="text-foreground font-medium">Configuration</span> tab.
          </p>
        </div>

        <div className="border-border -mx-6 -mb-6 mt-2 flex items-center gap-2 border-t px-6 py-4">
          <Button onClick={() => advanceTour()} type="button" variant="ghost">
            Maybe later
          </Button>
          <div className="flex-1" />
          <Button onClick={handleOpenConfig} type="button">
            Open Configuration
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
