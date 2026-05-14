import type {BillingFreeUserLimitDTO} from '../../../../shared/transport/types/dto'

import {useGetFreeUserLimit} from '../api/get-free-user-limit'

export function useFreeMonthlyCredits({enabled}: {enabled: boolean}): BillingFreeUserLimitDTO['monthly'] | undefined {
  const {data} = useGetFreeUserLimit({enabled})
  return data?.limit?.monthly
}
