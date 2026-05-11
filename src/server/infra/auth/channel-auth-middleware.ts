import type {RequestContext, RequestHandler} from '../../core/interfaces/transport/i-transport-server.js'

import {ChannelUnauthorizedError} from '../../core/domain/channel/errors.js'

/**
 * Phase-1 channel auth middleware (DESIGN §5.6 step 5; CHANNEL_PROTOCOL.md §2).
 *
 * Wraps every `channel:*` request handler with a token check. The token is
 * compared against the daemon-local token supplied by
 * {@link readOrCreateDaemonAuthToken} at startup; the expected value is
 * captured as a closure-bound constant per `withChannelAuth` invocation so
 * the daemon can rotate the token only via restart (Phase-3 hardens this).
 *
 * Behaviour:
 *  - Missing `ctx.auth.token` → throws ChannelUnauthorizedError.
 *  - Token mismatch → throws ChannelUnauthorizedError.
 *  - Valid token → handler runs with the original (data, clientId, ctx).
 *
 * Origin-check tightening (Layer 2 per DESIGN §5.6 step 4) is deferred to
 * Phase 3 — Phase 1 ships token-only validation.
 *
 * The middleware accepts non-channel handlers unchanged so a single
 * registration pattern works for everything; non-channel events keep their
 * existing behaviour (no token required).
 */

export type ChannelAuthMiddleware = <TReq, TRes>(
  inner: RequestHandler<TReq, TRes>,
) => RequestHandler<TReq, TRes>

export const makeChannelAuthMiddleware = (expectedToken: string): ChannelAuthMiddleware => <TReq, TRes>(inner: RequestHandler<TReq, TRes>): RequestHandler<TReq, TRes> =>
    async (data: TReq, clientId: string, ctx?: RequestContext): Promise<TRes> => {
      const token = ctx?.auth?.token
      if (token === undefined || token.length === 0) {
        throw new ChannelUnauthorizedError('missing daemon auth token')
      }

      if (token !== expectedToken) {
        throw new ChannelUnauthorizedError('invalid daemon auth token')
      }

      return inner(data, clientId, ctx)
    }
