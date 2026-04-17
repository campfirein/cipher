import {Button} from '@campfirein/byterover-packages/components/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '@campfirein/byterover-packages/components/tooltip'
import {Book} from 'lucide-react'
import {useState} from 'react'

import logo from '../assets/logo-byterover.svg'
import {AuthMenu} from '../features/auth/components/auth-menu'
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
    ? `${activeProvider.name}${activeConfig?.activeModel ? ` / ${activeConfig.activeModel}` : ''}`
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
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: provider/model + docs + login */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger render={
            <Button className="text-sm bg-background hover:bg-muted py-1.5 px-3 border border-border gap-2" onClick={() => setProviderDialogOpen(true)} size="sm" />
          }>
            {providerLabel}
            {!activeProvider && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />}
          </TooltipTrigger>
          {!activeProvider && (
            <TooltipContent>
              Configure to use curate/query feature
            </TooltipContent>
          )}
        </Tooltip>
        <ProviderFlowDialog onOpenChange={setProviderDialogOpen} open={providerDialogOpen} />

        <a
          className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs transition-colors hover:bg-muted"
          href="https://docs.byterover.dev"
          rel="noopener noreferrer"
          target="_blank"
        >
          <Book className="size-4" />
          Docs
        </a>

        <AuthMenu />
      </div>
    </header>
  )
}
