import type {NavigateFunction} from 'react-router-dom'

import {toast} from 'sonner'

import {VcErrorCode} from '../../shared/transport/events/vc-events'
import {type ErrorContext, formatError} from './error-messages'

type ConfigCta = {
  label: string
  target: string
}

const CONFIG_CTA: Record<string, ConfigCta> = {
  [VcErrorCode.CONFIG_KEY_NOT_SET]: {label: 'Set identity', target: '/configuration#identity'},
  [VcErrorCode.NO_REMOTE]: {label: 'Set remote', target: '/configuration#remotes'},
  [VcErrorCode.USER_NOT_CONFIGURED]: {label: 'Set identity', target: '/configuration#identity'},
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const {code} = error as {code: unknown}
  return typeof code === 'string' ? code : undefined
}

/**
 * Surface a VC error as a toast. The message always comes from `formatError`
 * (single source of truth); when the error code maps to a Configuration panel,
 * a one-click CTA is attached that deep-links the user to that section.
 */
export function toastVcError(
  error: unknown,
  fallback: string,
  navigate: NavigateFunction,
  context: ErrorContext = {},
): void {
  const message = formatError(error, fallback, context)
  const cta = CONFIG_CTA[errorCode(error) ?? '']

  if (cta) {
    toast.error(message, {
      action: {
        label: cta.label,
        onClick: () => navigate(cta.target),
      },
    })
    return
  }

  toast.error(message)
}
