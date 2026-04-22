import {useEffect} from 'react'

import {useAuthStore} from '../features/auth/stores/auth-store'
import {useModelStore} from '../features/model/stores/model-store'
import {useGetActiveProviderConfig} from '../features/provider/api/get-active-provider-config'
import {useGetProviders} from '../features/provider/api/get-providers'
import {useProviderStore} from '../features/provider/stores/provider-store'
import {useTransportStore} from '../stores/transport-store'

export function StatusBar() {
  const version = useTransportStore((state) => state.version)
  const spaceName = useAuthStore((state) => state.brvConfig?.spaceName)
  const teamName = useAuthStore((state) => state.brvConfig?.teamName)
  const {data: providersData} = useGetProviders()
  const {data: activeConfig} = useGetActiveProviderConfig()

  useEffect(() => {
    if (!providersData) return
    useProviderStore.getState().setProviders(providersData.providers)
    const activeProvider = providersData.providers.find((provider) => provider.isCurrent)
    useProviderStore.getState().setActiveProviderId(activeProvider?.id ?? null)
  }, [providersData])

  useEffect(() => {
    if (!activeConfig) return
    useProviderStore.getState().setActiveProviderId(activeConfig.activeProviderId)
    useModelStore.getState().setActiveModel(activeConfig.activeModel ?? null)
  }, [activeConfig])

  const activeProviderId = activeConfig?.activeProviderId ?? null
  const activeModel = activeConfig?.activeModel ?? null
  const providerName =
    providersData?.providers.find((provider) => provider.id === activeProviderId)?.name ?? activeProviderId ?? 'None'

  return (
    <footer className="flex flex-wrap gap-3 px-6 pb-6">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-card/80 px-3 py-2 text-muted-foreground text-sm shadow-xs">
        <span className="text-muted-foreground uppercase tracking-wider text-xs">Daemon</span>
        <span>{version || 'Unknown'}</span>
      </div>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-card/80 px-3 py-2 text-muted-foreground text-sm shadow-xs">
        <span className="text-muted-foreground uppercase tracking-wider text-xs">Provider</span>
        <span>{providerName}</span>
      </div>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-card/80 px-3 py-2 text-muted-foreground text-sm shadow-xs">
        <span className="text-muted-foreground uppercase tracking-wider text-xs">Model</span>
        <span>{activeModel ?? 'None'}</span>
      </div>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-card/80 px-3 py-2 text-muted-foreground text-sm shadow-xs">
        <span className="text-muted-foreground uppercase tracking-wider text-xs">Space</span>
        <span>{teamName && spaceName ? `${teamName}/${spaceName}` : 'Not connected'}</span>
      </div>
    </footer>
  )
}
