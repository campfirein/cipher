import type {IncomingMessage, Server, ServerResponse} from 'node:http'
import type {Socket} from 'node:net'

import http from 'node:http'

import type {ProviderCallbackResult} from './types.js'

import {OAUTH_CALLBACK_TIMEOUT_MS} from '../../../shared/constants/oauth.js'
import {
  ProviderCallbackOAuthError,
  ProviderCallbackStateError,
  ProviderCallbackTimeoutError,
  ProviderOAuthError,
} from './errors.js'

const DEFAULT_CALLBACK_PATH = '/auth/callback'

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>ByteRover - Authorization Successful</title>
  <style>
    body { font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f0f0f; color: #e5e5e5; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #17b26a; margin-bottom: 1rem; }
    p { color: #a3a3a3; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to ByteRover.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>ByteRover - Authorization Failed</title>
  <style>
    body { font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f0f0f; color: #e5e5e5; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #a3a3a3; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p>An error occurred during authorization.</p>
    <div class="error">${escapeHtml(message)}</div>
  </div>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

type ProviderCallbackServerOptions = {
  callbackPath?: string
  port: number
}

export class ProviderCallbackServer {
  private readonly callbackPath: string
  private readonly connections = new Set<Socket>()
  private isStopping = false
  private onCallback: ((code: string, state: string) => void) | undefined
  private onError: ((error: Error) => void) | undefined
  private pendingTimeout: ReturnType<typeof setTimeout> | undefined
  private readonly port: number
  private server: Server | undefined = undefined

  public constructor(options: ProviderCallbackServerOptions) {
    this.port = options.port
    this.callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH
  }

  public getAddress(): undefined | {port: number} {
    const address = this.server?.address()
    if (address !== null && address !== undefined && typeof address !== 'string') {
      return {port: address.port}
    }

    return undefined
  }

  public async start(): Promise<number> {
    const address = this.getAddress()
    if (address !== undefined) {
      return address.port
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res)
      })

      this.server.on('connection', (conn: Socket) => {
        this.connections.add(conn)
        conn.on('close', () => {
          this.connections.delete(conn)
        })
      })

      this.server.on('error', reject)

      this.server.listen(this.port, '127.0.0.1', () => {
        const address = this.server?.address()
        if (address !== null && address !== undefined && typeof address !== 'string') {
          resolve(address.port)
        } else {
          reject(new Error('Failed to start provider callback server'))
        }
      })
    })
  }

  public async stop(): Promise<void> {
    if (this.isStopping) return

    this.isStopping = true

    // Reject any pending waitForCallback promise so consumers don't hang
    this.onError?.(new ProviderOAuthError('Callback server was stopped'))
    this.onCallback = undefined
    this.onError = undefined

    if (this.pendingTimeout !== undefined) {
      clearTimeout(this.pendingTimeout)
      this.pendingTimeout = undefined
    }

    return new Promise((resolve) => {
      if (this.server === undefined) {
        this.isStopping = false
        resolve()
        return
      }

      for (const conn of this.connections) {
        conn.destroy()
      }

      this.connections.clear()

      this.server.close(() => {
        this.server = undefined
        this.isStopping = false
        resolve()
      })
    })
  }

  public waitForCallback(
    expectedState: string,
    timeoutMs = OAUTH_CALLBACK_TIMEOUT_MS,
  ): Promise<ProviderCallbackResult> {
    if (this.onCallback !== undefined) {
      return Promise.reject(new ProviderOAuthError('A callback is already pending'))
    }

    const promise = new Promise<ProviderCallbackResult>((resolve, reject) => {
      let settled = false

      this.pendingTimeout = setTimeout(() => {
        if (!settled) {
          settled = true
          this.pendingTimeout = undefined
          reject(new ProviderCallbackTimeoutError(timeoutMs))
        }
      }, timeoutMs)

      this.onCallback = (code: string, state: string) => {
        if (settled) return
        clearTimeout(this.pendingTimeout)
        this.pendingTimeout = undefined

        if (state !== expectedState) {
          settled = true
          reject(new ProviderCallbackStateError())
          return
        }

        settled = true
        resolve({code, state})
      }

      this.onError = (error: Error) => {
        if (settled) return
        clearTimeout(this.pendingTimeout)
        this.pendingTimeout = undefined
        settled = true
        reject(error)
      }
    })

    // Auto-close server after callback or timeout (ticket requirement)
    const autoClose = (): Promise<void> => this.stop()
    promise.then(autoClose, autoClose)

    return promise
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`)

    if (url.pathname !== this.callbackPath) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    const error = url.searchParams.get('error')
    const errorDescription = url.searchParams.get('error_description')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (error !== null) {
      res.writeHead(400, {'Content-Type': 'text/html'})
      res.end(errorHtml(errorDescription ?? error))
      this.onError?.(new ProviderCallbackOAuthError(error, errorDescription ?? undefined))
      this.onCallback = undefined
      this.onError = undefined
      return
    }

    if (code === null || state === null) {
      res.writeHead(400, {'Content-Type': 'text/html'})
      res.end(errorHtml('Missing code or state parameter'))
      this.onError?.(new ProviderOAuthError('Missing code or state parameter'))
      this.onCallback = undefined
      this.onError = undefined
      return
    }

    res.writeHead(200, {'Content-Type': 'text/html'})
    res.end(SUCCESS_HTML)
    this.onCallback?.(code, state)
    this.onCallback = undefined
    this.onError = undefined
  }
}
