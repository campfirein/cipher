import {Button} from '@campfirein/byterover-packages/components/button'
import {Book} from 'lucide-react'
import {useState} from 'react'

import logo from '../assets/logo-byterover.svg'
import {ProjectDropdown} from '../features/project/components/project-dropdown'
import {useGetActiveProviderConfig} from '../features/provider/api/get-active-provider-config'
import {useGetProviders} from '../features/provider/api/get-providers'
import {ProviderFlowDialog} from '../features/provider/components/provider-flow'
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
    <header className="flex items-center gap-4 bg-card px-6 py-3.5">
      {/* Left: logo + project + branch */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <img alt="ByteRover" className="w-32" src={logo} />
          {version && <span className="text-primary-foreground text-xs font-medium">v{version}</span>}
        </div>

        <ProjectDropdown />

        <span className="text-sm">&lt;branch&gt;</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: provider/model + docs + login */}
      <div className="flex items-center gap-2">
        <Button className="text-sm bg-background hover:bg-muted py-1.5 px-3 border border-border gap-2" onClick={() => setProviderDialogOpen(true)} size="sm">
          {providerLabel}
          {!activeProvider && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />}
        </Button>
        <ProviderFlowDialog onOpenChange={setProviderDialogOpen} open={providerDialogOpen} />

        <a className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs transition-colors hover:bg-muted" href="https://docs.byterover.dev" rel="noopener noreferrer" target="_blank">
          <Book className="size-4" />
          Docs
        </a>

        <span className="text-sm">&lt;login&gt;</span>
      </div>
    </header>
  )
}
