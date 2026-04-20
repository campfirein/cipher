import {Badge} from '@campfirein/byterover-packages/components/badge'
import {Button} from '@campfirein/byterover-packages/components/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '@campfirein/byterover-packages/components/tooltip'
import {useState} from 'react'

import logo from '../assets/logo-byterover.svg'
import {AuthMenu} from '../features/auth/components/auth-menu'
import {HelpMenu} from '../features/onboarding/components/help-menu'
import {ProjectDropdown} from '../features/project/components/project-dropdown'
import {useGetActiveProviderConfig} from '../features/provider/api/get-active-provider-config'
import {useGetProviders} from '../features/provider/api/get-providers'
import {ProviderFlowDialog} from '../features/provider/components/provider-flow'
import {BranchDropdown} from '../features/vc/components/branch-dropdown'
import {useTransportStore} from '../stores/transport-store'

export function Header() {
  const version = useTransportStore((s) => s.version)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const {data: providersData} = useGetProviders()
  const {data: activeConfig} = useGetActiveProviderConfig()

  const activeProvider = providersData?.providers.find((p) => p.isCurrent)
  const providerLabel = activeProvider
    ? `${activeProvider.name}${activeConfig?.activeModel ? ` | ${activeConfig.activeModel}` : ''}`
    : 'No model configured'

  return (
    <header className="flex items-center gap-4 px-6 py-3.5">
      {/* Left: logo + project + branch */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <img alt="ByteRover" className="w-32" src={logo} />
          {version && <span className="text-primary-foreground text-xs font-medium">v{version}</span>}
        </div>

        <ProjectDropdown />

        <BranchDropdown />

        <Badge
          aria-label="Running against the local daemon"
          className="border-primary-foreground/40 bg-primary-foreground/15 text-primary-foreground mono gap-1 px-1.5 text-[9px] leading-none font-semibold tracking-[0.16em] uppercase"
          title="You're viewing the local web UI, served from the daemon on your machine."
          variant="outline"
        >
          <span aria-hidden className="bg-primary-foreground size-1 shrink-0 rounded-full" />
          <span className="leading-none">Local</span>
        </Badge>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: provider/model + docs + login */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger render={<Button onClick={() => setProviderDialogOpen(true)} size="sm" variant="ghost" />}>
            {providerLabel}
            {!activeProvider && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />}
          </TooltipTrigger>
          {!activeProvider && <TooltipContent>Configure to use curate/query feature</TooltipContent>}
        </Tooltip>
        <ProviderFlowDialog onOpenChange={setProviderDialogOpen} open={providerDialogOpen} />

        <HelpMenu />

        <AuthMenu />
      </div>
    </header>
  )
}
