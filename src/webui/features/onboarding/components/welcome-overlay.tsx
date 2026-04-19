import {Button} from '@campfirein/byterover-packages/components/button'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@campfirein/byterover-packages/components/dialog'
import {Sparkles} from 'lucide-react'

import logoUrl from '../../../assets/logo.svg'
import {useTransportStore} from '../../../stores/transport-store'
import {useOnboardingStore} from '../stores/onboarding-store'

export function WelcomeOverlay() {
  const seenWelcome = useOnboardingStore((s) => s.seenWelcome)
  const dismissWelcome = useOnboardingStore((s) => s.dismissWelcome)
  const startTour = useOnboardingStore((s) => s.startTour)
  const projectPath = useTransportStore((s) => s.selectedProject)

  if (seenWelcome) return null

  return (
    <Dialog onOpenChange={(open) => !open && dismissWelcome()} open>
      <DialogContent
        className="flex max-w-[420px] flex-col items-center gap-6 p-8 text-center sm:max-w-[420px]"
        showCloseButton={false}
      >
        <img alt="Byterover" className="size-11" src={logoUrl} />

        <div className="flex flex-col gap-2.5">
          <DialogTitle className="text-foreground text-xl font-semibold tracking-tight">
            Welcome to ByteRover
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm leading-relaxed">
            A 3-minute tour will get you from zero to your first answer. You can restart it any time from the{' '}
            <span className="text-foreground font-medium">Help</span> menu in the top-right.
          </DialogDescription>
        </div>

        <div className="flex w-full max-w-[300px] flex-col gap-2">
          <Button onClick={() => startTour()} size="lg">
            <Sparkles className="size-4" />
            Take the tour
          </Button>
          <Button
            className="text-muted-foreground hover:text-foreground text-xs"
            onClick={() => dismissWelcome()}
            variant="link"
          >
            Skip — take me in
          </Button>
        </div>

        {projectPath && (
          <p className="text-identifier mono max-w-full truncate text-[10px] tracking-wider" title={projectPath}>
            {projectPath}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
