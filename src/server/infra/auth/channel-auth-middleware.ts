import type {RequestContext, RequestHandler} from '../../core/interfaces/transport/i-transport-server.js'

import {ChannelUnauthorizedError} from '../../core/domain/channel/errors.js'

/**
 * Channel auth middleware (DESIGN §5.6 step 5; CHANNEL_PROTOCOL.md §2).
 *
 * Wraps every `channel:*` request handler with a token check. As of Slice
 * 3.5a the expected token is resolved via a provider callback per request
 * so {@link DaemonTokenProvider.rotate} takes effect without re-registering
 * handlers. The string-literal overload is preserved for back-compat with
 * existing tests that build a static token.
 *
 * Behaviour:
 *  - Missing `ctx.auth.token` → throws ChannelUnauthorizedError.
 *  - Token mismatch with the value returned by the provider → throws
 *    ChannelUnauthorizedError.
 *  - Valid token → handler runs with the original (data, clientId, ctx).
 *
 * Origin-check tightening (Layer 2 per DESIGN §5.6 step 4) lands in Slice
 * 3.5b.
 */

export type ChannelAuthMiddleware = <TReq, TRes>(
  inner: RequestHandler<TReq, TRes>,
) => RequestHandler<TReq, TRes>

export const makeChannelAuthMiddleware = (
  expectedTokenOrProvider: (() => string) | string,
): ChannelAuthMiddleware => {
  const provider = typeof expectedTokenOrProvider === 'function'
    ? expectedTokenOrProvider
    : (): string => expectedTokenOrProvider

  return <TReq, TRes>(inner: RequestHandler<TReq, TRes>): RequestHandler<TReq, TRes> =>
    async (data: TReq, clientId: string, ctx?: RequestContext): Promise<TRes> => {
      const token = ctx?.auth?.token
      if (token === undefined || token.length === 0) {
        throw new ChannelUnauthorizedError('missing daemon auth token')
      }

      if (token !== provider()) {
        throw new ChannelUnauthorizedError('invalid daemon auth token')
      }

      return inner(data, clientId, ctx)
    }
}
