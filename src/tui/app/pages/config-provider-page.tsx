/**
 * ConfigProviderPage
 *
 * Shown when the user has no active model configured.
 * Renders ProviderFlow to guide them through provider setup.
 */

import {useQueryClient} from '@tanstack/react-query'
import React, {useCallback} from 'react'

import {getActiveProviderConfigQueryOptions} from '../../features/provider/api/get-active-provider-config.js'
import {ProviderFlow} from '../../features/provider/components/provider-flow.js'
import {MainLayout} from '../layouts/main-layout.js'

export function ConfigProviderPage(): React.ReactNode {
  const queryClient = useQueryClient()

  const handleComplete = useCallback(() => {
    queryClient.invalidateQueries(getActiveProviderConfigQueryOptions())
  }, [queryClient])

  return (
    <MainLayout showInput={false}>
      <ProviderFlow
        hideCancelButton
        onCancel={() => {}}
        onComplete={handleComplete}
        providerDialogTitle="Set up a provider to start:"
      />
    </MainLayout>
  )
}
