import type {BillingFreeUserLimitDTO} from '../../../../shared/transport/types/dto'

import {useAuthStore} from '../../auth/stores/auth-store'
import {useGetFreeUserLimit} from '../api/get-free-user-limit'

export function useFreeMonthlyCredits({enabled}: {enabled: boolean}): BillingFreeUserLimitDTO['monthly'] | undefined {
  const isAuthorized = useAuthStore((s) => s.isAuthorized)
  const {data} = useGetFreeUserLimit({enabled: isAuthorized && enabled})
  return data?.limit?.monthly
}
