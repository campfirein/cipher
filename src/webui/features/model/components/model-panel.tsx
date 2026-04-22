import { Badge } from '@campfirein/byterover-packages/components/badge'
import { Button } from '@campfirein/byterover-packages/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campfirein/byterover-packages/components/card'
import {useQueryClient} from '@tanstack/react-query'
import {useEffect, useState} from 'react'

import type {ModelDTO} from '../../../../shared/transport/types/dto'

import {getActiveProviderConfigQueryOptions, useGetActiveProviderConfig} from '../../provider/api/get-active-provider-config'
import {useGetProviders} from '../../provider/api/get-providers'
import {getModelsQueryOptions, useGetModels} from '../api/get-models'
import {useGetModelsByProviders} from '../api/get-models-by-providers'
import {useSetActiveModel} from '../api/set-active-model'
import {useModelStore} from '../stores/model-store'

type Feedback = {
  text: string
  tone: 'error' | 'success'
}

function formatContextLength(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`
  return `${value}`
}

export function ModelPanel() {
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const queryClient = useQueryClient()
  const storeActiveModel = useModelStore((s) => s.activeModel)
  const {data: providersData, isLoading: isLoadingProviders} = useGetProviders()
  const {data: activeConfig} = useGetActiveProviderConfig()
  const setActiveModelMutation = useSetActiveModel()

  const connectedProviders = (providersData?.providers ?? []).filter((provider) => provider.isConnected || provider.isCurrent)
  const activeProviderId = activeConfig?.activeProviderId ?? connectedProviders[0]?.id
  const activeProviderName =
    providersData?.providers.find((provider) => provider.id === activeProviderId)?.name ?? activeProviderId ?? 'None'

  const singleProviderModels = useGetModels({
    providerId: activeProviderId ?? '',
    queryConfig: {enabled: Boolean(activeProviderId)},
  })

  const multiProviderModels = useGetModelsByProviders({
    providerIds: connectedProviders.map((provider) => provider.id),
    queryConfig: {
      enabled: !activeProviderId && connectedProviders.length > 0,
    },
  })

  useEffect(() => {
    if (!singleProviderModels.data) return
    useModelStore.getState().setModels({
      activeModel: singleProviderModels.data.activeModel,
      favorites: singleProviderModels.data.favorites,
      models: singleProviderModels.data.models,
      recent: singleProviderModels.data.recent,
    })
  }, [singleProviderModels.data])

  const groupedModels = (() => {
    const groups = new Map<string, ModelDTO[]>()
    const models = activeProviderId ? (singleProviderModels.data?.models ?? []) : (multiProviderModels.data?.models ?? [])

    for (const model of models) {
      const group = groups.get(model.provider) ?? []
      group.push(model)
      groups.set(model.provider, group)
    }

    return [...groups.entries()]
  })()

  async function handleSetActiveModel(modelId: string, providerId: string, contextLength: number) {
    try {
      await setActiveModelMutation.mutateAsync({contextLength, modelId, providerId})
      useModelStore.getState().setActiveModel(modelId)
      await queryClient.invalidateQueries({queryKey: getActiveProviderConfigQueryOptions().queryKey})
      await queryClient.invalidateQueries({queryKey: getModelsQueryOptions(providerId).queryKey})
      setFeedback({text: `Active model updated to ${modelId}.`, tone: 'success'})
    } catch (setModelError) {
      setFeedback({
        text: setModelError instanceof Error ? setModelError.message : 'Failed to set active model',
        tone: 'error',
      })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="shadow-sm ring-border/70" size="sm">
        <CardHeader>
          <div>
            <CardTitle className="font-semibold">Model selection</CardTitle>
            <CardDescription>
              {activeProviderId
                ? `Showing the active provider catalog for ${activeProviderName}.`
                : 'No active provider is set, so connected-provider catalogs are merged.'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {feedback ? <div className={feedback.tone === 'error' ? 'p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive' : 'p-4 border border-primary/20 rounded-xl bg-primary/5 text-primary'}>{feedback.text}</div> : null}
          {isLoadingProviders ? <div className="p-4 border border-blue-500/20 rounded-xl bg-blue-50 text-blue-700">Loading providers…</div> : null}
          {connectedProviders.length === 0 ? (
            <div className="p-4 border border-yellow-500/20 rounded-xl bg-yellow-50 text-yellow-700">Connect a provider first to load available models.</div>
          ) : null}
          {singleProviderModels.error ? <div className="p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive">{singleProviderModels.error.message}</div> : null}
          {multiProviderModels.error ? <div className="p-4 border border-destructive/20 rounded-xl bg-destructive/5 text-destructive">{multiProviderModels.error.message}</div> : null}
          {multiProviderModels.data?.providerErrors ? (
            <div className="p-4 border border-yellow-500/20 rounded-xl bg-yellow-50 text-yellow-700">
              {Object.entries(multiProviderModels.data.providerErrors)
                .map(([providerId, providerError]) => `${providerId}: ${providerError}`)
                .join(' | ')}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {groupedModels.map(([providerName, models]) => (
        <Card className="shadow-sm ring-border/70" key={providerName} size="sm">
          <CardHeader>
            <div>
              <CardTitle className="font-semibold">{providerName}</CardTitle>
              <CardDescription>{models.length} available models</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(17rem,1fr))]">
              {models.map((model) => {
                const isActive = model.id === (activeConfig?.activeModel ?? storeActiveModel)

                return (
                  <Card
                    className={isActive ? 'gap-3 px-4 shadow-none ring-primary/30 bg-primary/5' : 'gap-3 px-4 shadow-none ring-border/80'}
                    key={model.id}
                    size="sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="font-semibold">{model.name}</CardTitle>
                        <CardDescription>{model.description ?? model.id}</CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {isActive ? <Badge className="rounded-sm border-transparent bg-primary/10 text-primary" variant="outline">Active</Badge> : null}
                        {model.isFree ? <Badge className="rounded-sm border-blue-500/20 bg-blue-500/10 text-blue-600" variant="outline">Free</Badge> : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                        <div className="text-xs tracking-wider uppercase text-muted-foreground">Context</div>
                        <div className="break-words">{`${formatContextLength(model.contextLength)} tokens`}</div>
                      </Card>
                      <Card className="gap-1 rounded-lg bg-card px-3 py-3 shadow-none ring-border/80" size="sm">
                        <div className="text-xs tracking-wider uppercase text-muted-foreground">Pricing</div>
                        <div className="break-words">{`In $${model.pricing.inputPerM}/M · Out $${model.pricing.outputPerM}/M`}</div>
                      </Card>
                    </div>

                    <div className="flex flex-wrap gap-2.5">
                      {isActive ? null : (
                        <Button
                          className="cursor-pointer inline-flex items-center justify-center gap-2 h-10 px-4 border border-primary/30 bg-primary text-foreground text-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md"
                          onClick={() => handleSetActiveModel(model.id, model.providerId, model.contextLength)}
                        >
                          Use model
                        </Button>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
